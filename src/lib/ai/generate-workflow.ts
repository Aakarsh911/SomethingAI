import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  CURRENT_GRAPH_VERSION,
  parseGraph,
  type WorkflowGraph,
} from "@/lib/workflows/graph";
import { assertValidSchedule, describeSchedule } from "@/lib/workflows/schedule";
import {
  renderToolsForPrompt,
  type AvailableTool,
} from "@/lib/ai/tool-catalog";

/**
 * Turns a natural-language request into a workflow draft.
 *
 * Nothing here writes to the database. The model is wrong often enough —
 * picking a near-miss tool, inventing a schedule the user did not ask for —
 * that a draft the user confirms is the only honest design. The caller saves.
 */

// Latest general-purpose model at time of writing; override to trade quality
// for cost and latency, both of which the user feels directly in a chat.
const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";

/**
 * The model's output shape, deliberately flatter than WorkflowGraph.
 *
 * Structured Outputs runs in strict mode, which forbids the things the graph
 * schema leans on: defaults, open-ended records, optional keys. Rather than
 * contorting the graph schema to fit, the model emits a linear plan and this
 * module assembles the graph. Tool arguments come back as a JSON *string* for
 * the same reason — strict mode has no way to express an arbitrary object.
 */
const stepSchema = z.object({
  kind: z
    .enum(["tool", "llm"])
    .describe('"tool" calls an MCP tool; "llm" transforms the previous step with a model.'),
  serverSlug: z
    .string()
    .nullable()
    .describe("Exactly as listed in the available tools. Null for an llm step."),
  toolSlug: z
    .string()
    .nullable()
    .describe("Exactly as listed. Never invent one. Null for an llm step."),
  instruction: z
    .string()
    .nullable()
    .describe(
      "For an llm step: what to do with the incoming data, e.g. 'Summarise these emails into five bullets.' Null for a tool step.",
    ),
  purpose: z.string().describe("One short line on what this step does."),
  inputsJson: z
    .string()
    .describe('Tool arguments as a JSON object string, e.g. {"query":"is:unread"}. Use {} if none or for an llm step.'),
});

const planSchema = z.object({
  name: z.string(),
  description: z.string(),
  trigger: z.enum(["MANUAL", "SCHEDULE"]),
  cron: z
    .string()
    .nullable()
    .describe("Five-field cron in the user's timezone. Null unless SCHEDULE."),
  timezone: z
    .string()
    .nullable()
    .describe("IANA zone, e.g. Asia/Kolkata. Null unless SCHEDULE."),
  steps: z.array(stepSchema),
  problem: z
    .string()
    .nullable()
    .describe(
      "Set when the request cannot be built from the available tools, explaining what is missing. Leave steps empty in that case.",
    ),
});

export type WorkflowDraft = {
  name: string;
  description: string;
  graph: WorkflowGraph;
  trigger: "MANUAL" | "SCHEDULE";
  cron: string | null;
  timezone: string | null;
  /** Rendered schedule for the confirmation screen, e.g. "Every Thursday at 09:00". */
  scheduleLabel: string | null;
  steps: {
    kind: "tool" | "llm";
    serverSlug: string | null;
    toolSlug: string | null;
    purpose: string;
  }[];
};

export class GenerationError extends Error {}

function systemPrompt(tools: AvailableTool[], timezone: string, now: Date) {
  return `You turn a user's request into an automation workflow.

AVAILABLE TOOLS — you may only use these. Copy slugs exactly.
${renderToolsForPrompt(tools)}

CONTEXT
- The user's timezone is ${timezone}.
- The current time there is ${now.toLocaleString("en-US", { timeZone: timezone })}.

RULES
1. Never invent a serverSlug or toolSlug. If the request needs an integration
   that is not listed, set "problem" explaining which one is missing, and
   return no steps. Do not substitute a vaguely similar tool.
1a. Summarising, rewriting, extracting, classifying and composing text are NOT
   tools. Use a step with kind "llm" and an "instruction" for those. Only an
   external integration being absent counts as a "problem" — never report a
   missing summarisation or text-generation capability, because the llm step
   provides it.
2. Steps run in order, each feeding the next. Keep it to the minimum that
   satisfies the request.
3. If the user describes a recurring time ("every Thursday", "each morning"),
   set trigger to SCHEDULE, write a five-field cron, and set timezone to
   ${timezone} unless they name a different one. The cron is read in that
   zone, not UTC.
4. If no recurrence is described, trigger is MANUAL and cron and timezone are
   both null.
5. Pick a concrete hour for vague times: "morning" is 09:00, "evening" 18:00.
6. "name" is a short label, under 60 characters.`;
}

/** Assembles a linear graph from the model's plan. */
function planToGraph(plan: z.infer<typeof planSchema>): WorkflowGraph {
  const nodes: unknown[] = [
    { id: "trigger", kind: "trigger", label: "Start", config: {} },
  ];
  const edges: unknown[] = [];

  let previous = "trigger";
  plan.steps.forEach((step, index) => {
    const id = `step-${index + 1}`;
    const label = step.purpose.slice(0, 200);

    if (step.kind === "llm") {
      nodes.push({
        id,
        kind: "llm",
        label,
        instruction: step.instruction ?? step.purpose,
      });
    } else {
      // A model that ignores the "JSON object string" instruction should not
      // take down the request; an empty argument set is recoverable by editing.
      let inputs: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(step.inputsJson || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          inputs = parsed as Record<string, unknown>;
        }
      } catch {
        inputs = {};
      }

      nodes.push({
        id,
        kind: "tool",
        label,
        serverSlug: step.serverSlug,
        toolSlug: step.toolSlug,
        inputs,
      });
    }

    edges.push({ from: previous, to: id, when: "always" });
    previous = id;
  });

  const result = parseGraph({ nodes, edges });
  if (!result.success) {
    throw new GenerationError(
      `The model produced a graph that failed validation: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  return result.data;
}

export async function generateWorkflowDraft(input: {
  prompt: string;
  tools: AvailableTool[];
  timezone: string;
  now?: Date;
}): Promise<WorkflowDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new GenerationError("OPENAI_API_KEY is not set.");
  }
  if (input.tools.length === 0) {
    throw new GenerationError(
      "Connect an MCP server first — there are no tools to build a workflow from.",
    );
  }

  const now = input.now ?? new Date();
  const client = new OpenAI({ apiKey });

  const response = await client.responses.parse({
    model: MODEL,
    input: [
      { role: "system", content: systemPrompt(input.tools, input.timezone, now) },
      { role: "user", content: input.prompt },
    ],
    text: { format: zodTextFormat(planSchema, "workflow_plan") },
  });

  const plan = response.output_parsed;
  if (!plan) {
    throw new GenerationError("The model returned no usable plan.");
  }
  if (plan.problem) {
    throw new GenerationError(plan.problem);
  }
  if (plan.steps.length === 0) {
    throw new GenerationError(
      "The model produced a workflow with no steps. Try describing the task more concretely.",
    );
  }

  // Strict mode guarantees the shape, not the contents: slugs still have to be
  // checked against the real catalogue, or an invented tool reaches the
  // database and fails at run time instead of here.
  const known = new Set(input.tools.map((tool) => `${tool.serverSlug}:${tool.toolSlug}`));
  const invented = plan.steps
    .filter((step) => step.kind === "tool")
    .filter((step) => !known.has(`${step.serverSlug}:${step.toolSlug}`))
    .map((step) => `${step.serverSlug ?? "?"}/${step.toolSlug ?? "?"}`);
  if (invented.length > 0) {
    throw new GenerationError(
      `The model referenced tools that do not exist: ${invented.join(", ")}.`,
    );
  }

  let cron: string | null = null;
  let timezone: string | null = null;
  let scheduleLabel: string | null = null;

  if (plan.trigger === "SCHEDULE") {
    if (!plan.cron) {
      throw new GenerationError(
        "The model asked for a schedule but produced no cron expression.",
      );
    }
    cron = plan.cron;
    timezone = plan.timezone ?? input.timezone;
    // Throws on a malformed expression or unknown zone, so a broken schedule
    // never reaches the confirmation screen looking legitimate.
    assertValidSchedule(cron, timezone);
    scheduleLabel = describeSchedule(cron, timezone);
  }

  return {
    name: plan.name.slice(0, 60),
    description: plan.description,
    graph: planToGraph(plan),
    trigger: plan.trigger,
    cron,
    timezone,
    scheduleLabel,
    steps: plan.steps.map((step) => ({
      kind: step.kind,
      serverSlug: step.serverSlug,
      toolSlug: step.toolSlug,
      purpose: step.purpose,
    })),
  };
}

export { CURRENT_GRAPH_VERSION };
