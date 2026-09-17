import type { WorkflowGraph, WorkflowNode } from "@/lib/workflows/graph";

/**
 * Walks a workflow graph and runs it.
 *
 * Deliberately free of Prisma, Composio, OpenAI and anything request-shaped:
 * everything with a side effect arrives through `ExecutionContext`. That is
 * what makes a dry run a different context rather than a flag threaded through
 * the traversal, and what lets the whole engine be tested without a database
 * or a network.
 */

export type StepStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";

export type StepOutcome = {
  nodeId: string;
  kind: WorkflowNode["kind"];
  serverSlug: string | null;
  toolSlug: string | null;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date;
};

export type ToolCall = {
  serverSlug: string;
  toolSlug: string;
  inputs: Record<string, unknown>;
};

export type ModelCall = {
  instruction: string;
  input: unknown;
};

export type ExecutionContext = {
  callTool(call: ToolCall): Promise<unknown>;
  callModel(call: ModelCall): Promise<string>;
  /**
   * Called as each step settles, before the next one starts.
   *
   * Persisting per step rather than at the end is the difference between a
   * crashed run you can read and one that left nothing behind.
   */
  onStep?(outcome: StepOutcome): Promise<void> | void;
  now?(): Date;
  /** Wall-clock cap for the whole run. Checked between steps. */
  deadline?: Date;
  /** Stops a graph that loops back on itself from running forever. */
  maxSteps?: number;
};

export type ExecutionResult = {
  status: "SUCCEEDED" | "FAILED";
  steps: StepOutcome[];
  error: string | null;
  /** Output of the last step that produced one, which is what a run "returns". */
  output: unknown;
};

const DEFAULT_MAX_STEPS = 50;

export async function executeGraph(
  graph: WorkflowGraph,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const now = context.now ?? (() => new Date());
  const maxSteps = context.maxSteps ?? DEFAULT_MAX_STEPS;
  const steps: StepOutcome[] = [];

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const trigger = graph.nodes.find((node) => node.kind === "trigger");
  if (!trigger) {
    return {
      status: "FAILED",
      steps,
      error: "This workflow has no trigger node, so there is nowhere to start.",
      output: null,
    };
  }

  // Keyed by node id so a later step can reach past its immediate predecessor,
  // which is what {{steps.<id>.output}} is for.
  const outputs = new Map<string, unknown>();
  let previous: unknown = null;

  const fail = (error: string): ExecutionResult => ({
    status: "FAILED",
    steps,
    error,
    output: previous,
  });

  const visited = new Set<string>();
  let current: WorkflowNode | undefined = trigger;

  while (current) {
    if (visited.has(current.id)) {
      return fail(
        `This workflow loops back to "${current.id}". Runs must not revisit a step.`,
      );
    }
    visited.add(current.id);

    if (steps.length >= maxSteps) {
      return fail(`This workflow exceeded the ${maxSteps}-step limit for one run.`);
    }
    if (context.deadline && now() >= context.deadline) {
      return fail("This run ran out of time before it finished.");
    }

    // The trigger is an entry point, not work. It is not recorded as a step
    // because there is no attempt to retry and no output to inspect.
    if (current.kind !== "trigger") {
      const outcome = await runNode(current, {
        context,
        now,
        scope: { previous, steps: outputs },
      });
      steps.push(outcome);
      await context.onStep?.(outcome);

      if (outcome.status === "FAILED") {
        return fail(outcome.error ?? `Step "${current.id}" failed.`);
      }

      // A branch routes; it does not transform. Letting its empty output
      // become `previous` would hide the real data from the step after it —
      // and from its own condition, which is evaluated next.
      if (current.kind !== "branch") {
        outputs.set(current.id, outcome.output);
        previous = outcome.output;
      }
    }

    const next = await chooseNext(current, graph, byId, {
      previous,
      steps: outputs,
    });
    if (!next.ok) return fail(next.error);
    current = next.node;
  }

  return { status: "SUCCEEDED", steps, error: null, output: previous };
}

type Scope = { previous: unknown; steps: Map<string, unknown> };

async function runNode(
  node: Exclude<WorkflowNode, { kind: "trigger" }>,
  options: { context: ExecutionContext; now: () => Date; scope: Scope },
): Promise<StepOutcome> {
  const { context, now, scope } = options;
  const startedAt = now();

  const base = {
    nodeId: node.id,
    kind: node.kind,
    serverSlug: node.kind === "tool" ? node.serverSlug : null,
    toolSlug: node.kind === "tool" ? node.toolSlug : null,
    startedAt,
  };

  const failed = (input: unknown, error: string): StepOutcome => ({
    ...base,
    status: "FAILED",
    input,
    output: null,
    error,
    finishedAt: now(),
  });

  if (node.kind === "branch") {
    // A branch decides where to go next; the decision is made in chooseNext.
    // Recording it as a step keeps it visible in the run log.
    return {
      ...base,
      status: "SUCCEEDED",
      input: node.condition,
      output: null,
      error: null,
      finishedAt: now(),
    };
  }

  if (node.kind === "llm") {
    let instruction: string;
    try {
      instruction = String(resolve(node.instruction, scope));
    } catch (error) {
      return failed(node.instruction, describe(error));
    }

    try {
      const output = await context.callModel({ instruction, input: scope.previous });
      return {
        ...base,
        status: "SUCCEEDED",
        input: { instruction },
        output,
        error: null,
        finishedAt: now(),
      };
    } catch (error) {
      return failed({ instruction }, describe(error));
    }
  }

  let inputs: Record<string, unknown>;
  try {
    inputs = resolve(node.inputs, scope) as Record<string, unknown>;
  } catch (error) {
    return failed(node.inputs, describe(error));
  }

  try {
    const output = await context.callTool({
      serverSlug: node.serverSlug,
      toolSlug: node.toolSlug,
      inputs,
    });
    return {
      ...base,
      status: "SUCCEEDED",
      input: inputs,
      output,
      error: null,
      finishedAt: now(),
    };
  } catch (error) {
    return failed(inputs, describe(error));
  }
}

type NextNode =
  | { ok: true; node: WorkflowNode | undefined }
  | { ok: false; error: string };

async function chooseNext(
  current: WorkflowNode,
  graph: WorkflowGraph,
  byId: Map<string, WorkflowNode>,
  scope: Scope,
): Promise<NextNode> {
  const outgoing = graph.edges.filter((edge) => edge.from === current.id);
  if (outgoing.length === 0) return { ok: true, node: undefined };

  let eligible = outgoing;

  if (current.kind === "branch") {
    let taken: boolean;
    try {
      taken = evaluateCondition(current.condition, scope);
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
    const wanted = taken ? "true" : "false";
    // "always" edges out of a branch fire whichever way it went; that is the
    // only sensible reading of an edge that declares no side.
    eligible = outgoing.filter(
      (edge) => edge.when === wanted || edge.when === "always",
    );
    if (eligible.length === 0) return { ok: true, node: undefined };
  }

  if (eligible.length > 1) {
    // Running one arbitrarily would make the run silently wrong, and running
    // both needs a merge rule this engine does not have yet.
    return {
      ok: false,
      error: `Step "${current.id}" has ${eligible.length} outgoing paths. Parallel branches are not supported yet.`,
    };
  }

  const node = byId.get(eligible[0].to);
  if (!node) {
    return { ok: false, error: `Edge points at unknown step "${eligible[0].to}".` };
  }
  return { ok: true, node };
}

/* ---------------------------------------------------------------- templates */

/**
 * `{{previous.output}}` is the canonical way a step reads the step before it.
 *
 * The aliases exist because the generator has emitted several spellings of the
 * same idea, and workflows saved with the older ones are already in the
 * database. Normalising here is cheaper than a data migration.
 */
const ALIASES: Record<string, string> = {
  previous_step_output: "previous.output",
  "previous_step.output": "previous.output",
  "previousstep.output": "previous.output",
  "last.output": "previous.output",
  "previous.output": "previous.output",
  output: "previous.output",
};

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function resolve(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return resolveString(value, scope);
  if (Array.isArray(value)) return value.map((entry) => resolve(entry, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        resolve(nested, scope),
      ]),
    );
  }
  return value;
}

function resolveString(value: string, scope: Scope): unknown {
  const whole = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  // A string that is nothing but a placeholder yields the raw value, so an
  // object or a number survives instead of becoming "[object Object]".
  if (whole) return lookup(whole[1], scope);

  return value.replace(PLACEHOLDER, (_match, path: string) => {
    const resolved = lookup(path, scope);
    return typeof resolved === "string" ? resolved : stringify(resolved);
  });
}

function lookup(rawPath: string, scope: Scope): unknown {
  const path = rawPath.trim();
  const normalized = ALIASES[path.toLowerCase()] ?? path;
  const parts = normalized.split(".").filter(Boolean);

  let cursor: unknown;
  if (parts[0] === "previous") {
    cursor = parts[1] === "output" ? scope.previous : undefined;
    if (parts[1] !== "output") {
      throw new TemplateError(`Unknown reference "{{${rawPath}}}".`);
    }
    return walk(cursor, parts.slice(2), rawPath);
  }

  if (parts[0] === "steps") {
    const nodeId = parts[1];
    if (!nodeId || !scope.steps.has(nodeId)) {
      throw new TemplateError(
        `"{{${rawPath}}}" refers to step "${nodeId ?? ""}", which has not run.`,
      );
    }
    if (parts[2] !== "output") {
      throw new TemplateError(`Unknown reference "{{${rawPath}}}".`);
    }
    return walk(scope.steps.get(nodeId), parts.slice(3), rawPath);
  }

  throw new TemplateError(`Unknown reference "{{${rawPath}}}".`);
}

function walk(value: unknown, parts: string[], rawPath: string): unknown {
  let cursor = value;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) {
      throw new TemplateError(`"{{${rawPath}}}" reads past a missing value.`);
    }
    if (Array.isArray(cursor)) {
      const index = Number(part);
      if (!Number.isInteger(index)) {
        throw new TemplateError(`"{{${rawPath}}}" indexes an array with "${part}".`);
      }
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== "object") {
      throw new TemplateError(`"{{${rawPath}}}" reads "${part}" off a non-object.`);
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export class TemplateError extends Error {}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/* --------------------------------------------------------------- conditions */

/**
 * Evaluates a branch condition.
 *
 * Deliberately not `eval` or `new Function`: conditions come out of a language
 * model and are stored in a JSON blob, so executing them as code would make
 * every saved workflow a script. The supported grammar is small on purpose,
 * and anything outside it fails loudly rather than defaulting to false — a
 * branch that silently always takes one side is worse than one that stops.
 */
export function evaluateCondition(condition: string, scope: Scope): boolean {
  const resolved = String(resolve(condition, scope)).trim();

  if (/^true$/i.test(resolved)) return true;
  if (/^(false|)$/i.test(resolved)) return false;

  const comparison = resolved.match(
    /^(.*?)\s*(==|!=|>=|<=|>|<|\bcontains\b|\bstarts with\b|\bends with\b)\s*(.*)$/i,
  );

  if (!comparison) {
    if (/^is not empty$/i.test(resolved)) return false;
    throw new ConditionError(
      `Cannot evaluate the branch condition "${condition}". Supported forms are true/false, ==, !=, >, <, >=, <=, contains, starts with and ends with.`,
    );
  }

  const left = unquote(comparison[1]);
  const operator = comparison[2].toLowerCase();
  const right = unquote(comparison[3]);

  switch (operator) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "starts with":
      return left.startsWith(right);
    case "ends with":
      return left.endsWith(right);
    default:
      break;
  }

  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new ConditionError(
      `Branch condition "${condition}" compares values that are not numbers.`,
    );
  }
  if (operator === ">") return a > b;
  if (operator === "<") return a < b;
  if (operator === ">=") return a >= b;
  return a <= b;
}

export class ConditionError extends Error {}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return quoted ? quoted[2] : trimmed;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
