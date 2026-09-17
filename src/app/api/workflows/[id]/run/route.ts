import { getCurrentUser, unauthorized } from "@/lib/auth";
import { runWorkflow } from "@/lib/workflows/runtime";
import { listRuns } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

/**
 * Runs a workflow now and answers with the finished run.
 *
 * Execution is inline, so the response is the result rather than a promise of
 * one. That keeps "Run now" honest — the button cannot report success for
 * something that has not happened yet.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id } = await params;

  const summary = await runWorkflow({
    userId: user.id,
    workflowId: id,
    trigger: "MANUAL",
    dryRun: body.dryRun === true,
  });

  // Null means the workflow is missing or owned by somebody else. The same
  // answer for both, so this cannot be used to probe for ids.
  if (!summary) {
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  }

  return Response.json({ run: summary });
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
