import { getCurrentUser, unauthorized } from "@/lib/auth";
import { listAllRuns } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

/** All recent runs across all workflows for the current user. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const runs = await listAllRuns(user.id);

  return Response.json({
    runs: runs.map((run) => ({
      id: run.id,
      workflowId: run.workflowId,
      workflowName: run.workflow.name,
      status: run.status,
      trigger: run.trigger,
      error: run.error,
      output: run.output,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      stepCount: run.stepRuns.length,
      steps: run.stepRuns.map((step) => ({
        nodeId: step.nodeId,
        status: step.status,
        serverSlug: step.serverSlug,
        toolSlug: step.toolSlug,
        error: step.error,
        output: step.output,
      })),
    })),
  });
}
