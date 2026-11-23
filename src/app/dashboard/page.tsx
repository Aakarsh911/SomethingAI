import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAllRuns } from "@/lib/workflows/store";
import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const runs = await listAllRuns(user.id);

  return (
    <DashboardView
      runs={runs.map((run) => ({
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
      }))}
    />
  );
}
