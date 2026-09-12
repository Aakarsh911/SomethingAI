import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listServersForUser } from "@/lib/mcp/servers";
import { parseGraph } from "@/lib/workflows/graph";
import { getWorkflow, listVersions, listWorkflows } from "@/lib/workflows/store";
import { WorkflowStudio } from "../studio";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workflow",
};

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const [workflows, servers, selected, versions] = await Promise.all([
    listWorkflows(user.id),
    listServersForUser(user.id),
    getWorkflow(user.id, id),
    listVersions(user.id, id),
  ]);

  if (!selected) notFound();

  const parsed = parseGraph(selected.graph);
  if (!parsed.success) {
    throw new Error("Stored workflow graph failed validation.");
  }

  return (
    <WorkflowStudio
      workflows={workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        updatedAt: workflow.updatedAt.toISOString(),
      }))}
      selected={{
        id: selected.id,
        name: selected.name,
        description: selected.description,
        updatedAt: selected.updatedAt.toISOString(),
        graph: parsed.data,
      }}
      versions={versions.map((version) => ({
        id: version.id,
        revision: version.revision,
        note: version.note,
        createdAt: version.createdAt.toISOString(),
      }))}
      connections={servers.filter(
        (server) => server.connection?.status === "CONNECTED",
      )}
    />
  );
}
