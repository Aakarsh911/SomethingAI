import { getCurrentUser, unauthorized } from "@/lib/auth";
import { listVersions, restoreWorkflowVersion } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; revision: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id, revision: rawRevision } = await params;
  const revision = Number(rawRevision);
  if (!Number.isInteger(revision) || revision < 1) {
    return Response.json({ error: "Revision must be a positive integer." }, { status: 400 });
  }

  const workflow = await restoreWorkflowVersion(user.id, id, revision);
  if (!workflow) {
    return Response.json({ error: "Version not found." }, { status: 404 });
  }

  const versions = await listVersions(user.id, id);
  return Response.json({
    workflow: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      trigger: workflow.trigger,
      isEnabled: workflow.isEnabled,
      serverSlugs: workflow.serverSlugs,
      graphVersion: workflow.graphVersion,
      graph: workflow.graph,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    },
    versions: versions.map((version) => ({
      id: version.id,
      revision: version.revision,
      note: version.note,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}
