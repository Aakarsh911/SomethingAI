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
  reconcileToolInputs,
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
  nodeId: z
    .string()
    .nullable()
    .describe(
      "In EDIT MODE, copy the exact current node id for a kept or changed step. Use null for a new step. Always null in CREATE MODE.",
    ),
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

/**
 * One thing the model needs the user to tell it.
 *
 * Asking costs a round trip; guessing costs a workflow that runs for weeks
 * against the wrong recipient or the wrong label. The `id` is what the answer
 * comes back keyed by, so it has to be stable across the two turns.
 */
const questionSchema = z.object({
  id: z
    .string()
    .describe('Stable snake_case key for this question, e.g. "recipient_email".'),
  question: z.string().describe("One line, addressed to the user."),
  why: z
    .string()
    .describe("What the workflow cannot do without it, in one short line."),
  suggestion: z
    .string()
    .nullable()
    .describe(
      "A value to prefill when there is a likely answer, e.g. the user's own address. Null when there is nothing sensible to offer.",
    ),
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
  questions: z
    .array(questionSchema)
    .describe(
      "Values only the user can supply. Non-empty means the draft is not ready: leave steps empty and ask. Empty when everything needed is known.",
    ),
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
  /**
   * Arguments the model invented that the tool does not accept, as
   * "TOOL_SLUG.key". Surfaced rather than swallowed so a step that lost an
   * argument is visible before the workflow is saved.
   */
  droppedArgs: string[];
  steps: {
    kind: "tool" | "llm";
    serverSlug: string | null;
    toolSlug: string | null;
    purpose: string;
  }[];
};

export type WorkflowQuestion = z.infer<typeof questionSchema>;

/**
 * Either the model has enough to build, or it needs the user to fill something
 * in. A union rather than a draft with an optional questions field, so a caller
 * cannot accidentally save a draft that was never really finished.
 */
export type GenerationResult =
  | { kind: "draft"; draft: WorkflowDraft }
  | { kind: "questions"; questions: WorkflowQuestion[] };

/** One turn of the builder conversation, as sent by the client. */
export type BuilderMessage = { role: "user" | "assistant"; content: string };

export class GenerationError extends Error {}

export type ExistingWorkflowContext = {
  name: string;
  description: string | null;
  graph: WorkflowGraph;
  trigger: "MANUAL" | "SCHEDULE";
  cron: string | null;
  timezone: string | null;
};

function systemPrompt(
  tools: AvailableTool[],
  timezone: string,
  now: Date,
  identity: Identity,
  existing?: ExistingWorkflowContext,
) {
  const mode = existing
    ? `EDIT MODE
The user is editing the workflow below. Apply their latest request as a
targeted change and return the COMPLETE revised workflow, including everything
that should remain unchanged. Do not remove, rename, reschedule, or reinterpret
parts they did not ask to change.

CURRENT WORKFLOW
${JSON.stringify(existing, null, 2)}

The current graph is linear. Preserve its order unless the user asks to reorder
it. A request such as "add a final summary step" means keep all current steps
and append that step; it does not mean build a new workflow from scratch.`
    : `CREATE MODE
Build a complete new workflow from the conversation.`;

  return `You turn a user's request into an automation workflow.

${mode}

AVAILABLE TOOLS — you may only use these. Copy slugs exactly.
${renderToolsForPrompt(tools)}

CONTEXT
- The user's timezone is ${timezone}.
- The current time there is ${now.toLocaleString("en-US", { timeZone: timezone })}.
- They signed in to this app as ${identity.email}. That is an app login, NOT
  necessarily the mailbox or account any integration acts on. Never assume a
  tool operates on it.
${renderAccountsForPrompt(identity.accounts)}

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
6. Use only the argument names listed under "args" for each tool, spelled
   exactly as shown. Do not invent argument names and do not rewrite them
   into prose — "max_results", never "max results".
7. "name" is a short label, under 60 characters.
8. Never invent a value only the user can know. Recipient addresses, label
   and folder names, spreadsheet or document names, search terms that change
   the meaning of a step, and a choice between several connected accounts all
   fall under this. When the request does not state one and CONTEXT does not
   give it to you, put it in "questions", leave "steps" empty, and ask for
   everything you are missing in a single batch.
9. A placeholder is not an answer. Writing "me", "user@example.com",
   "recipient", "TODO" or an empty string into an argument the user has to
   choose is the failure this rule exists to prevent — that workflow saves
   cleanly and then sends real mail to the wrong place. Ask instead.
10. Do not ask about things you can reasonably default, because a needless
   question is worse than a good guess: vague hours (rule 5), result limits,
   verbosity flags, and anything already settled in CONTEXT or earlier in the
   conversation. If the user has answered a question, do not ask it again.
11. In EDIT MODE, keep existing concrete argument values unless the user asks
   to change them. Treat the current workflow as authoritative context, not as
   another user request to simplify.
12. In EDIT MODE, copy each kept or changed step's exact current id into
   "nodeId"; use null only for a newly added step. Never use the trigger id and
   never invent an id. In CREATE MODE, every "nodeId" must be null.
13. An argument naming which account a tool acts on — "user_id", "userId" and
   the like — means "the account this integration is already connected to".
   Write "me". An email address there is read as an attempt to act on someone
   else's mailbox and is refused.
14. "Me" and "myself" as a RECIPIENT need a real address, and rule 13 does not
   apply. Use the connected account's address when CONTEXT gives it. When
   CONTEXT says that address is UNKNOWN, ask for it — the app sign-in address
   is often a different account, so guessing it sends the mail elsewhere.
15. Narrow the search itself; do not fetch broadly and sift afterwards. Put
   every filter the request implies into the tool's own query — keywords,
   senders, labels, date ranges — so the results come back already relevant.
16. Only then keep the result limit small, 10 to 25 unless the user names a
   number, and leave full-payload and verbose options off unless a later step
   reads the body. Providers reject oversized responses.
   Rules 15 and 16 go together and are dangerous apart. A small limit on a
   broad query silently drops the very items the workflow exists to find: it
   returns the most recent N of everything, and the match may not be in them.
   A wide query with no limit is refused outright for being too large. Narrow
   first, then cap.`;
}

/** Who the workflow is being built for, so the model need not ask the obvious. */
export type Identity = {
  email: string;
  accounts: { serverSlug: string; serverName: string; label: string | null }[];
};

function renderAccountsForPrompt(accounts: Identity["accounts"]): string {
  if (accounts.length === 0) return "- Nothing is connected.";
  // Saying "unknown" out loud matters. The provider often does not tell us
  // which mailbox an account belongs to, and the model's instinctive fallback
  // is the app login — which is frequently a different account entirely.
  const lines = accounts.map((account) =>
    account.label
      ? `  - ${account.serverName} (${account.serverSlug}) acts on ${account.label}`
      : `  - ${account.serverName} (${account.serverSlug}) — which address it acts on is UNKNOWN`,
  );
  return `- Connected accounts:\n${lines.join("\n")}`;
}

/** Assembles a linear graph from the model's plan. */
function planToGraph(
  plan: z.infer<typeof planSchema>,
  tools: AvailableTool[],
  existing?: WorkflowGraph,
): { graph: WorkflowGraph; droppedArgs: string[] } {
  const byKey = new Map(
    tools.map((tool) => [`${tool.serverSlug}:${tool.toolSlug}`, tool]),
  );
  const droppedArgs: string[] = [];
  // Laid out left-to-right rather than left to default to (0, 0): the studio
  // canvas positions nodes from these coordinates, and a generated workflow
  // would otherwise open as a single stack of overlapping cards.
  const LANE_Y = 180;
  const COLUMN_X = 80;
  const COLUMN_GAP = 260;
  const at = (index: number) => ({ x: COLUMN_X + index * COLUMN_GAP, y: LANE_Y });

  const oldTrigger = existing?.nodes.find((node) => node.kind === "trigger");
  const triggerId = oldTrigger?.id ?? "trigger";
  const nodes: unknown[] = [
    oldTrigger
      ? { ...oldTrigger }
      : { id: triggerId, kind: "trigger", label: "Start", position: at(0), config: {} },
  ];
  const edges: unknown[] = [];
  const existingSteps =
    existing?.nodes.filter((node) => node.kind === "tool" || node.kind === "llm") ?? [];
  const claimed = new Set<string>();
  const reservedIds = new Set(existing?.nodes.map((node) => node.id) ?? [triggerId]);
  const matches = new Map<number, (typeof existingSteps)[number]>();
  const existingById = new Map(existingSteps.map((node) => [node.id, node]));

  // Explicit ids are the strongest signal and make duplicate tool calls or
  // reordered steps unambiguous. Validate them before using any fallback.
  plan.steps.forEach((step, index) => {
    if (!step.nodeId) return;
    const node = existingById.get(step.nodeId);
    if (!node) {
      throw new GenerationError(
        `The model referenced an unknown existing node "${step.nodeId}".`,
      );
    }
    if (claimed.has(node.id)) {
      throw new GenerationError(
        `The model reused existing node "${step.nodeId}" more than once.`,
      );
    }
    claimed.add(node.id);
    matches.set(index, node);
  });

  // Claim semantic matches for the whole plan before falling back to matching
  // by position. Otherwise inserting a Gmail step at the start could steal the
  // id of the old first Gmail step before that unchanged step is considered.
  plan.steps.forEach((step, index) => {
    if (matches.has(index)) return;
    const exact = existingSteps.find((node) => {
      if (claimed.has(node.id) || node.kind !== step.kind) return false;
      return node.kind === "tool"
        ? node.serverSlug === step.serverSlug && node.toolSlug === step.toolSlug
        : node.instruction.trim() === (step.instruction ?? step.purpose).trim();
    });
    if (exact) {
      claimed.add(exact.id);
      matches.set(index, exact);
    }
  });

  plan.steps.forEach((step, index) => {
    if (matches.has(index)) return;
    const sameSlot = existingSteps[index];
    if (sameSlot && !claimed.has(sameSlot.id) && sameSlot.kind === step.kind) {
      claimed.add(sameSlot.id);
      matches.set(index, sameSlot);
    }
  });

  const freshId = (index: number) => {
    const base = `step-${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (reservedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    reservedIds.add(candidate);
    return candidate;
  };
  const usedPositions = new Set(
    [oldTrigger, ...matches.values()]
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .map((node) => `${node.position.x}:${node.position.y}`),
  );
  const freshPosition = (index: number) => {
    const candidate = at(index + 1);
    while (usedPositions.has(`${candidate.x}:${candidate.y}`)) {
      candidate.y += 160;
    }
    usedPositions.add(`${candidate.x}:${candidate.y}`);
    return candidate;
  };

  let previous = triggerId;
  plan.steps.forEach((step, index) => {
    const oldNode = matches.get(index);
    const id = oldNode?.id ?? freshId(index);
    const label = step.purpose.slice(0, 200);
    const position = oldNode?.position ?? freshPosition(index);

    if (step.kind === "llm") {
      nodes.push({
        id,
        kind: "llm",
        label,
        position,
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

      // The model names arguments from memory, so reconcile against the
      // tool's real input schema before the graph is built.
      const tool = byKey.get(`${step.serverSlug}:${step.toolSlug}`);
      if (tool) {
        const reconciled = reconcileToolInputs(inputs, tool.parameters);
        inputs = reconciled.inputs;
        droppedArgs.push(
          ...reconciled.dropped.map((key) => `${step.toolSlug}.${key}`),
        );
      }

      nodes.push({
        id,
        kind: "tool",
        label,
        position,
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
  return { graph: result.data, droppedArgs };
}

export async function generateWorkflowDraft(input: {
  messages: BuilderMessage[];
  tools: AvailableTool[];
  timezone: string;
  identity: Identity;
  existing?: ExistingWorkflowContext;
  now?: Date;
}): Promise<GenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new GenerationError("OPENAI_API_KEY is not set.");
  }
  if (input.tools.length === 0 && !input.existing) {
    throw new GenerationError(
      "Connect an MCP server first — there are no tools to build a workflow from.",
    );
  }
  if (input.messages.length === 0) {
    throw new GenerationError("Describe what you want to automate.");
  }

  const now = input.now ?? new Date();
  const client = new OpenAI({ apiKey });

  const response = await client.responses.parse({
    model: MODEL,
    input: [
      {
        role: "system",
        content: systemPrompt(
          input.tools,
          input.timezone,
          now,
          input.identity,
          input.existing,
        ),
      },
      ...input.messages,
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

  // Checked before the empty-steps guard: an unanswered question is the
  // reason there are no steps, and reporting it as a failure would throw away
  // the question the model just asked.
  if (plan.questions.length > 0) {
    return { kind: "questions", questions: plan.questions.slice(0, 6) };
  }

  if (plan.steps.length === 0 && !input.existing) {
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

  const assembled = planToGraph(plan, input.tools, input.existing?.graph);

  return {
    kind: "draft",
    draft: {
      name: plan.name.slice(0, 60),
      description: plan.description,
      graph: assembled.graph,
      droppedArgs: assembled.droppedArgs,
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
    },
  };
}

export { CURRENT_GRAPH_VERSION };
