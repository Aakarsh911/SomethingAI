import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hydrateNeededConnections } from "@/lib/mcp/needed";
import { listServersForUser } from "@/lib/mcp/servers";
import { parseGraph, toolServerSlugs } from "@/lib/workflows/graph";
import { scheduleView } from "@/lib/workflows/schedule";
import {
  getWorkflow,
  listVersions,
  listWorkflows,
  versionView,
} from "@/lib/workflows/store";
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
    listServersForUser(user.id, { connectedOnly: true }),
    getWorkflow(user.id, id),
    listVersions(user.id, id),
  ]);

  if (!selected) notFound();

  const parsed = parseGraph(selected.graph);
  if (!parsed.success) {
    throw new Error("Stored workflow graph failed validation.");
  }

  const neededConnections = (
    await hydrateNeededConnections(
      user.id,
      toolServerSlugs(parsed.data).map((serverSlug) => ({
        serverSlug,
        reason: `This workflow uses ${serverSlug}.`,
      })),
    )
  ).map((need) => ({
    ...need,
    reason: `This workflow uses ${need.server.name}.`,
  }));

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
        schedule: scheduleView(selected),
      }}
      versions={versions.map(versionView)}
      connections={servers.filter(
        (server) => server.connection?.status === "CONNECTED",
      )}
      neededConnections={neededConnections}
    />
  );
}
