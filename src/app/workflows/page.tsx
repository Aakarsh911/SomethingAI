import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listServersForUser } from "@/lib/mcp/servers";
import { listWorkflows } from "@/lib/workflows/store";
import { WorkflowStudio } from "./studio";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workflows",
};

export default async function WorkflowsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [workflows, servers] = await Promise.all([
    listWorkflows(user.id),
    listServersForUser(user.id, { connectedOnly: true }),
  ]);

  return (
    <WorkflowStudio
      workflows={workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        updatedAt: workflow.updatedAt.toISOString(),
      }))}
      selected={null}
      versions={[]}
      connections={servers.filter(
        (server) => server.connection?.status === "CONNECTED",
      )}
    />
  );
}
