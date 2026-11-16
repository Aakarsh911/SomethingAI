import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  CURRENT_GRAPH_VERSION,
  parseGraph,
  type WorkflowGraph,
} from "@/lib/workflows/graph";
import {
  GENERATED_TRIGGERS,
  assertValidSchedule,
  describeSchedule,
  type GeneratedTrigger,
  type UserTrigger,
} from "@/lib/workflows/schedule";
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
 * contorting the graph schema to fit, the model emits a flat list of steps,
 * each naming the step it follows, and this module assembles the graph. Tool arguments come back as a JSON *string* for
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
      "For an llm step: what to do with the incoming data, e.g. 'Summarise these emails into five bullets' or 'Search the web for today's top stories about this topic and write a short brief.' Null for a tool step.",
    ),
  after: z
    .number()
    .int()
    .nullable()
    .describe(
      "Index in this steps array (0-based) of the earlier step whose output this step works on. Usually the step just before it. Two steps that each act on the same result share the same value. Null only when the step starts straight from the trigger.",
    ),
  purpose: z.string().describe("One short line on what this step does."),
  inputsJson: z
    .string()
    .describe('Tool arguments as a JSON object string, e.g. {"query":"is:unread"} or {"body":"{{previous.output}}"}. Use {} if none or for an llm step.'),
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
  trigger: z.enum(GENERATED_TRIGGERS),
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
  connect: z
    .array(
      z.object({
        serverSlug: z
          .string()
          .describe("Exact slug from CONNECTABLE INTEGRATIONS."),
        reason: z
          .string()
          .describe("One short line on why this workflow needs that integration."),
      }),
    )
    .describe(
      "Integrations the user must connect before this workflow can be built. Non-empty means leave steps empty. Empty when every needed tool is already in AVAILABLE TOOLS.",
    ),
  problem: z
    .string()
    .nullable()
    .describe(
      "Set when the request cannot be built from AVAILABLE TOOLS or CONNECTABLE INTEGRATIONS, explaining what is missing. Leave steps empty in that case.",
    ),
});

export type WorkflowDraft = {
  name: string;
  description: string;
  graph: WorkflowGraph;
  trigger: GeneratedTrigger;
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
    /** Index of the step this one follows; null when it follows the trigger. */
    after: number | null;
  }[];
};

export type WorkflowQuestion = z.infer<typeof questionSchema>;

/**
 * Either the model has enough to build, or it needs the user to fill something
 * in. A union rather than a draft with an optional questions field, so a caller
 * cannot accidentally save a draft that was never really finished.
 */
export type ConnectNeed = {
  serverSlug: string;
  reason: string;
};

export type GenerationResult =
  | { kind: "draft"; draft: WorkflowDraft }
  | { kind: "questions"; questions: WorkflowQuestion[] }
  | { kind: "connect"; needs: ConnectNeed[] };

/** One turn of the builder conversation, as sent by the client. */
export type BuilderMessage = { role: "user" | "assistant"; content: string };

export class GenerationError extends Error {}

/** Turns a provider failure into a message the builder can show. */
function mappedProviderError(error: unknown): Error {
  if (error instanceof OpenAI.APIError) {
    if (
      error.code === "credit_balance_exhausted" ||
      error.type === "insufficient_quota"
    ) {
      return new GenerationError(
        "OpenAI has no credits left on this API key. Add credits in the OpenAI billing settings and try again.",
      );
    }
    if (error.status === 429) {
      return new GenerationError(
        "The model is rate-limited right now. Wait a moment and try again.",
      );
    }
    if (error.status === 401) {
      return new GenerationError(
        "The OpenAI API key was refused. Check OPENAI_API_KEY.",
      );
    }
  }
  return error instanceof Error ? error : new Error("Unknown provider error.");
}

export type ExistingWorkflowContext = {
  name: string;
  description: string | null;
  graph: WorkflowGraph;
  /** Wider than GeneratedTrigger: ONCE is shown to the model for context. */
  trigger: UserTrigger;
  cron: string | null;
  timezone: string | null;
  runAt: string | null;
};

function systemPrompt(
  tools: AvailableTool[],
  connectable: { slug: string; name: string }[],
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

Its edges say which step follows which. Preserve that shape unless the user
asks to change it: a step keeps following the same step it follows now. A
request such as "add a final summary step" means keep all current steps and
append that step; it does not mean build a new workflow from scratch.`
    : `CREATE MODE
Build a complete new workflow from the conversation.`;

  return `You turn a user's request into an automation workflow.

${mode}

AVAILABLE TOOLS — you may only use these. Copy slugs exactly.
${renderToolsForPrompt(tools)}

CONNECTABLE INTEGRATIONS — not yet in AVAILABLE TOOLS. If the request needs
one of these, put it in "connect", leave steps empty, and do not set "problem".
Copy the slug exactly.
${renderConnectableForPrompt(connectable)}

CONTEXT
- The user's timezone is ${timezone}.
- The current time there is ${now.toLocaleString("en-US", { timeZone: timezone })}.
- They signed in to this app as ${identity.email}. That is an app login, NOT
  necessarily the mailbox or account any integration acts on. Never assume a
  tool operates on it.
${renderAccountsForPrompt(identity.accounts)}

RULES
1. Never invent a serverSlug or toolSlug. If the request needs an integration
   that is in CONNECTABLE INTEGRATIONS, put it in "connect", leave steps and
   questions empty, and do not set "problem". If it is in neither AVAILABLE
   TOOLS nor CONNECTABLE INTEGRATIONS, set "problem" explaining which one is
   missing. Do not substitute a vaguely similar tool. Ask questions only after
   every needed integration is already in AVAILABLE TOOLS.
1a. Summarising, rewriting, extracting, classifying, composing text, and
   looking up current facts on the public web are NOT tools. Use a step with
   kind "llm" and an "instruction" for those. The llm step can search the web
   when the instruction needs news, documentation, or anything not already in
   the previous step. Only an external integration being absent counts as a
   "problem" — never report a missing summarisation, search, or
   text-generation capability, and never invent a search-engine tool for it.
2. Each step works on the output of the step named in its "after", usually
   the one just before it. When the request asks for several independent
   actions on the same result — "email it AND add it to my calendar" — give
   each of them that result's step as "after" instead of chaining one behind
   the other. A step may only follow an EARLIER step, and two paths that split
   must never merge back into one step. Keep it to the minimum that
   satisfies the request.
2a. An argument or instruction that needs an earlier step's result uses a
   reference, never a description of one:
     {{previous.output}}  the result of the step named in "after"
     {{steps.N.output}}   the result of step N, numbered like "after" (0-based)
   Step N must be upstream of the step using it: its "after", or that step's
   "after", and so on back to the trigger. A step on another path has not run
   yet, so it cannot be referenced.
   Writing "Use the sender from the fetched email" into an argument is the
   failure this rule exists to prevent: the tool receives that sentence
   literally, and a send step mails it to someone.
2b. You do not know the shape of a tool's result, so never guess a field path
   into it such as {{steps.0.output.messages.0.sender}}. When an argument needs
   one value out of a result — an address, a subject, an id — add an llm step
   that extracts exactly that value and replies with nothing else, and
   reference its output. Its instruction names its source with a reference,
   e.g. "Reply with only the sender's email address of this email:
   {{steps.0.output}}". Chain extraction steps one after another so a later
   step can still reference all of them.
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
   first, then cap.
17. In EDIT MODE, references in kept steps may name current node ids, e.g.
   {{steps.step-1.output}}. Keep those, and use step numbers for new ones.`;
}

/** Who the workflow is being built for, so the model need not ask the obvious. */
export type Identity = {
  email: string;
  accounts: { serverSlug: string; serverName: string; label: string | null }[];
};

function renderConnectableForPrompt(
  connectable: { slug: string; name: string }[],
): string {
  if (connectable.length === 0) {
    return "(none — every listed integration is already connected, or the catalog is empty)";
  }
  return connectable
    .map((server) => `- ${server.slug} — ${server.name}`)
    .join("\n");
}

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

/**
 * Lays a plan out as a tree: one column per depth, and a new row for every
 * path that splits off, so sibling steps do not open stacked on one another.
 */
function layoutPlan(parents: (number | null)[]) {
  const children = new Map<number | null, number[]>();
  parents.forEach((parent, index) => {
    children.set(parent, [...(children.get(parent) ?? []), index]);
  });

  const cells: { column: number; row: number }[] = [];
  let rows = 0;
  const place = (index: number, column: number, row: number) => {
    cells[index] = { column, row };
    (children.get(index) ?? []).forEach((child, i) => {
      place(child, column + 1, i === 0 ? row : ++rows);
    });
  };
  (children.get(null) ?? []).forEach((root, i) => {
    place(root, 1, i === 0 ? 0 : ++rows);
  });
  return cells;
}

/** Matches the step part of `{{steps.<ref>.…}}`, the only cross-step reference. */
const STEP_REFERENCE = /(\{\{\s*steps\.)([^.{}\s]+)/g;

/** Every string inside an argument template, for rewriting or checking. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fn));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, fn)]),
    );
  }
  return value;
}

/** Assembles the graph from the model's plan. */
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
  const LANE_GAP = 160;
  const COLUMN_X = 80;
  const COLUMN_GAP = 260;
  const at = (column: number, row = 0) => ({
    x: COLUMN_X + column * COLUMN_GAP,
    y: LANE_Y + row * LANE_GAP,
  });

  // Every step must follow an earlier one. That alone rules out loops and
  // merges: each step has exactly one parent, and parents come first.
  plan.steps.forEach((step, index) => {
    if (step.after !== null && (step.after < 0 || step.after >= index)) {
      throw new GenerationError(
        `The model made step ${index + 1} follow step ${step.after + 1}, which does not come before it.`,
      );
    }
  });
  const cells = layoutPlan(plan.steps.map((step) => step.after));

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
    const candidate = at(cells[index].column, cells[index].row);
    while (usedPositions.has(`${candidate.x}:${candidate.y}`)) {
      candidate.y += LANE_GAP;
    }
    usedPositions.add(`${candidate.x}:${candidate.y}`);
    return candidate;
  };

  const ids: string[] = [];

  // The model numbers steps because it cannot know the ids they will get.
  // Rewritten to ids here, and checked, because the engine only lets a step
  // read its own ancestors: a reference to a sibling or a later step would
  // save cleanly and then fail every run with "has not run".
  const ancestors = (index: number) => {
    const upstream = new Set<string>();
    for (let at = plan.steps[index].after; at !== null; at = plan.steps[at].after) {
      upstream.add(ids[at]);
    }
    return upstream;
  };
  const resolveReferences = (index: number, text: string) => {
    const upstream = ancestors(index);
    return text.replace(STEP_REFERENCE, (match, head: string, ref: string) => {
      const id = /^\d+$/.test(ref) ? ids[Number(ref)] : ref;
      if (id === undefined || !upstream.has(id)) {
        throw new GenerationError(
          `Step ${index + 1} reads "${match}…}}", which is not a step before it on the same path.`,
        );
      }
      return `${head}${id}`;
    });
  };

  plan.steps.forEach((step, index) => {
    const oldNode = matches.get(index);
    const id = oldNode?.id ?? freshId(index);
    ids.push(id);
    const label = step.purpose.slice(0, 200);
    const position = oldNode?.position ?? freshPosition(index);

    if (step.kind === "llm") {
      nodes.push({
        id,
        kind: "llm",
        label,
        position,
        instruction: resolveReferences(index, step.instruction ?? step.purpose),
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
      inputs = mapStrings(inputs, (text) => resolveReferences(index, text)) as Record<
        string,
        unknown
      >;

      // The model names arguments from memory, so reconcile against the
      // tool's real input schema before the graph is built.
      const tool = byKey.get(`${step.serverSlug}:${step.toolSlug}`);
      if (tool) {
        const reconciled = reconcileToolInputs(
          inputs,
          tool.schema.map((parameter) => parameter.name),
        );
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

    edges.push({
      from: step.after === null ? triggerId : ids[step.after],
      to: id,
      when: "always",
    });
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
  connectable?: { slug: string; name: string }[];
  timezone: string;
  identity: Identity;
  existing?: ExistingWorkflowContext;
  now?: Date;
}): Promise<GenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new GenerationError("OPENAI_API_KEY is not set.");
  }
  const connectable = input.connectable ?? [];
  if (input.tools.length === 0 && connectable.length === 0 && !input.existing) {
    throw new GenerationError(
      "Connect an MCP server first — there are no tools to build a workflow from.",
    );
  }
  if (input.messages.length === 0) {
    throw new GenerationError("Describe what you want to automate.");
  }

  const now = input.now ?? new Date();
  const client = new OpenAI({ apiKey });

  let plan: z.infer<typeof planSchema> | null;
  try {
    const response = await client.responses.parse({
      model: MODEL,
      input: [
        {
          role: "system",
          content: systemPrompt(
            input.tools,
            connectable,
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
    plan = response.output_parsed;
  } catch (error) {
    throw mappedProviderError(error);
  }
  if (!plan) {
    throw new GenerationError("The model returned no usable plan.");
  }
  if (plan.problem) {
    throw new GenerationError(plan.problem);
  }

  const connected = new Set(
    input.identity.accounts.map((account) => account.serverSlug),
  );
  const offered = new Set(connectable.map((server) => server.slug));
  const needs = plan.connect
    .filter(
      (need) =>
        offered.has(need.serverSlug) && !connected.has(need.serverSlug),
    )
    .slice(0, 6);
  if (needs.length > 0) {
    return { kind: "connect", needs };
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
        after: step.after,
      })),
    },
  };
}

export { CURRENT_GRAPH_VERSION };
