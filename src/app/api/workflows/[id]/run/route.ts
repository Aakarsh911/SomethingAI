import { getCurrentUser, unauthorized } from "@/lib/auth";
import { runWorkflow } from "@/lib/workflows/runtime";
import { listRuns } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

/** Covers the wait in runWorkflow, with room to spare. */
export const maxDuration = 300;

/**
 * Queues a workflow for the worker and answers with the finished run.
 *
 * The response waits for the result rather than returning a promise of one.
 * That keeps "Run now" honest — the button cannot report success for
 * something that has not happened yet. A run that outlasts the wait answers
 * 202 and carries on; its outcome lands in run history.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id } = await params;

  const outcome = await runWorkflow({
    userId: user.id,
    workflowId: id,
    trigger: "MANUAL",
    dryRun: body.dryRun === true,
  });

  // Null means the workflow is missing or owned by somebody else. The same
  // answer for both, so this cannot be used to probe for ids.
  if (!outcome) {
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  }

  if (outcome.kind === "pending") {
    const error =
      outcome.status === "QUEUED"
        ? "The run is queued but no worker has picked it up. Is the workflow worker running?"
        : "The run is still going. Its result will appear in run history.";
    return Response.json(
      { runId: outcome.runId, status: outcome.status, error },
      { status: 202 },
    );
  }

  return Response.json({ run: outcome.summary });
}

/** Recent runs for the run history panel. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const runs = await listRuns(user.id, id);

  return Response.json({
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      trigger: run.trigger,
      error: run.error,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      steps: run.stepRuns.map((step) => ({
        nodeId: step.nodeId,
        status: step.status,
        serverSlug: step.serverSlug,
        toolSlug: step.toolSlug,
        error: step.error,
      })),
    })),
  });
}
