import { enqueueRun, getRun, isFinished } from "@/lib/workflows/store";
import type { RunStatus, WorkflowTrigger } from "@/generated/prisma/enums";

/**
 * The app's side of running a workflow: queue it, then wait for the Go worker
 * (worker/) to finish it.
 *
 * Nothing here executes a step. The worker claims QUEUED rows, runs them and
 * writes the outcome back to WorkflowRun and WorkflowStepRun; this module
 * only reads that back into the shape the studio renders. Scheduled runs never
 * pass through here at all — the worker enqueues those itself.
 */

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
   * megabytes, and the full value is on WorkflowRun.output for anyone who
   * needs it.
   */
  output: string | null;
  steps: {
    nodeId: string;
    status: RunStatus;
    serverSlug: string | null;
    toolSlug: string | null;
    error: string | null;
    output: string | null;
  }[];
};

export type RunOutcome =
  | { kind: "finished"; summary: RunSummary }
  /** Queued and still in progress when the wait ran out. */
  | { kind: "pending"; runId: string; status: RunStatus };

/** Enough to read a summary in the UI, small enough not to ship a mailbox. */
const PREVIEW_LIMIT = 4000;

/**
 * How long a request waits for the worker, kept under a typical serverless
 * limit. A run that outlasts it keeps going and shows up in run history.
 */
const WAIT_MS = 240_000;

/**
 * A run nobody has claimed after this long means no worker is running —
 * almost always `npm run worker` not started in development. Said quickly
 * rather than after the full wait.
 */
const UNCLAIMED_MS = 15_000;

const POLL_MS = 500;

function preview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text.trim()) return null;
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n…` : text;
}

/** Null means the workflow is missing or belongs to someone else. */
export async function runWorkflow(options: RunOptions): Promise<RunOutcome | null> {
  const queued = await enqueueRun(options.userId, options.workflowId, options.trigger, {
    dryRun: options.dryRun,
  });
  if (!queued) return null;

  const started = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    const run = await getRun(options.userId, queued.id);
    // Deleted mid-run, taking the run with it by cascade.
    if (!run) return null;

    if (isFinished(run.status)) {
      return {
        kind: "finished",
        summary: {
          runId: run.id,
          status: run.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
          error: run.error,
          output: preview(run.output),
          steps: run.stepRuns.map((step) => ({
            nodeId: step.nodeId,
            status: step.status,
            serverSlug: step.serverSlug,
            toolSlug: step.toolSlug,
            error: step.error,
            output: preview(step.output),
          })),
        },
      };
    }

    const waited = Date.now() - started;
    if (
      waited >= WAIT_MS ||
      (run.status === "QUEUED" && waited >= UNCLAIMED_MS)
    ) {
      return { kind: "pending", runId: run.id, status: run.status };
    }
  }
}
