import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { executeComposioTool } from "@/lib/mcp/composio";
import {
  executeGraph,
  type ExecutionContext,
  type ExecutionResult,
  type StepOutcome,
} from "@/lib/workflows/execute";
import { parseGraph } from "@/lib/workflows/graph";
import {
  finishRun,
  markScheduledRun,
  recordStepRun,
  startRun,
} from "@/lib/workflows/store";
import type { WorkflowTrigger } from "@/generated/prisma/enums";

/**
 * Wires the pure executor to the real world: Composio for tools, OpenAI for
 * llm steps, Prisma for the run log.
 *
 * Everything that differs between a real run and a rehearsal lives in the
 * context built here, so `executeGraph` itself never learns what a dry run is.
 */

const MODEL = process.env.OPENAI_STEP_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5";

/** A single step should not be able to hold a request open indefinitely. */
const STEP_TIMEOUT_MS = 60_000;

/**
 * Whole-run cap, comfortably under a typical serverless limit.
 *
 * Runs execute inline today. The cap means a slow chain is recorded as a
 * failure we can read rather than being killed by the platform mid-step,
 * leaving a row stuck in RUNNING forever.
 */
const RUN_TIMEOUT_MS = 240_000;

export type RunOptions = {
  userId: string;
  workflowId: string;
  trigger: WorkflowTrigger;
  /**
   * Records the run without calling any tool or model.
   *
   * Every workflow here sends real email the first time it succeeds, so there
   * has to be a way to prove the wiring — templates, ordering, branches —
   * without doing that.
   */
  dryRun?: boolean;
};

export type RunSummary = {
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  error: string | null;
  /**
   * What the run produced, which for most workflows is the whole point of
   * having run it. Previewed rather than returned whole: a Gmail fetch is
   * megabytes, and the full value is on WorkflowStepRun for anyone who needs
   * it.
   */
  output: string | null;
  steps: {
    nodeId: string;
    status: StepOutcome["status"];
    serverSlug: string | null;
    toolSlug: string | null;
    error: string | null;
    output: string | null;
  }[];
};

/** Enough to read a summary in the UI, small enough not to ship a mailbox. */
const PREVIEW_LIMIT = 4000;

function preview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text.trim()) return null;
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n…` : text;
}

export async function runWorkflow(options: RunOptions): Promise<RunSummary | null> {
  const run = await startRun(options.userId, options.workflowId, options.trigger);
  if (!run) return null;

  const parsed = parseGraph(run.graphSnapshot);
  if (!parsed.success) {
    const error = "The stored workflow graph is invalid, so it cannot be run.";
    await finishRun(run.id, "FAILED", error);
    return { runId: run.id, status: "FAILED", error, output: null, steps: [] };
  }

  const context = options.dryRun
    ? dryRunContext()
    : await liveContext(options.userId);

  let result: ExecutionResult;
  try {
    result = await executeGraph(parsed.data, {
      ...context,
      deadline: new Date(Date.now() + RUN_TIMEOUT_MS),
      onStep: (outcome) => persistStep(run.id, outcome),
    });
  } catch (error) {
    // executeGraph is written not to throw, so reaching here means a bug or an
    // infrastructure failure. Either way the run must not stay RUNNING.
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(run.id, "FAILED", message);
    return { runId: run.id, status: "FAILED", error: message, output: null, steps: [] };
  }

  await finishRun(run.id, result.status, result.error ?? undefined);

  return {
    runId: run.id,
    status: result.status,
    error: result.error,
    output: preview(result.output),
    steps: result.steps.map((step) => ({
      nodeId: step.nodeId,
      status: step.status,
      serverSlug: step.serverSlug,
      toolSlug: step.toolSlug,
      error: step.error,
      output: preview(step.output),
    })),
  };
}

function persistStep(runId: string, outcome: StepOutcome) {
  return recordStepRun({
    runId,
    nodeId: outcome.nodeId,
    status: outcome.status === "SKIPPED" ? "CANCELED" : outcome.status,
    serverSlug: outcome.serverSlug,
    toolSlug: outcome.toolSlug,
    stepInput: outcome.input,
    output: outcome.output,
    error: outcome.error,
    startedAt: outcome.startedAt,
    finishedAt: outcome.finishedAt,
  }).then(() => undefined);
}

/**
 * Maps a graph's `serverSlug` onto the Composio account that backs it.
 *
 * Resolved once per run rather than per step: a ten-step Gmail workflow
 * should not make ten identical lookups, and a mid-run disconnect changing
 * behaviour between steps would be worse than failing consistently.
 */
async function liveContext(userId: string): Promise<ExecutionContext> {
  const connections = await prisma.userMcpConnection.findMany({
    where: { userId, status: "CONNECTED" },
    select: {
      externalAccountId: true,
      server: { select: { slug: true, isEnabled: true } },
    },
  });

  const accounts = new Map(
    connections
      .filter((connection) => connection.server.isEnabled)
      .map((connection) => [connection.server.slug, connection.externalAccountId]),
  );

  const openai = new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY"),
  });

  return {
    async callTool({ serverSlug, toolSlug, inputs }) {
      if (!accounts.has(serverSlug)) {
        throw new Error(
          `${serverSlug} is not connected, so "${toolSlug}" cannot run. Reconnect it under Integrations.`,
        );
      }

      return withTimeout(
        executeComposioTool({
          userId,
          toolSlug,
          arguments: inputs,
          connectedAccountId: accounts.get(serverSlug),
        }),
        `${toolSlug} took longer than ${STEP_TIMEOUT_MS / 1000}s`,
      );
    },

    async callModel({ instruction, input }) {
      const response = await withTimeout(
        openai.responses.create({
          model: MODEL,
          input: [
            {
              role: "system",
              content:
                "You transform data inside an automation workflow. Follow the instruction exactly and reply with the result only — no preamble, no commentary, no markdown fences.",
            },
            {
              role: "user",
              content: `INSTRUCTION\n${instruction}\n\nINPUT\n${renderInput(input)}`,
            },
          ],
        }),
        `the model step took longer than ${STEP_TIMEOUT_MS / 1000}s`,
      );

      return response.output_text ?? "";
    },
  };
}

/** Records what would have happened, calling nothing. */
function dryRunContext(): ExecutionContext {
  return {
    async callTool({ serverSlug, toolSlug, inputs }) {
      return { dryRun: true, serverSlug, toolSlug, arguments: inputs };
    },
    async callModel({ instruction }) {
      return `[dry run] would run the model with: ${instruction}`;
    },
  };
}

/**
 * Trims the previous step's output before it reaches the model.
 *
 * A Gmail fetch returns far more than a summary needs, and an unbounded blob
 * is both the slowest and the most expensive way to get a worse answer.
 */
function renderInput(input: unknown): string {
  if (input === null || input === undefined) return "(no input)";
  const text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  return text.length > 100_000 ? `${text.slice(0, 100_000)}\n…(truncated)` : text;
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), STEP_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/**
 * Runs everything that is due.
 *
 * `markScheduledRun` is called whether the run passed or failed, because a
 * workflow that fails at 09:00 should next be considered at its next slot,
 * not retried on every tick for the rest of the day.
 */
export async function runDueWorkflows(now = new Date(), limit = 25) {
  const due = await prisma.workflow.findMany({
    where: { isEnabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true, userId: true },
  });

  const results: { workflowId: string; summary: RunSummary | null }[] = [];

  for (const workflow of due) {
    // Advanced before the run, not after: an inline run that outlives the
    // request would otherwise be picked up again by the next tick and run
    // twice.
    await markScheduledRun(workflow.id, now);

    const summary = await runWorkflow({
      userId: workflow.userId,
      workflowId: workflow.id,
      trigger: "SCHEDULE",
    }).catch(() => null);

    results.push({ workflowId: workflow.id, summary });
  }

  return results;
}
