import { getCurrentUser, unauthorized } from "@/lib/auth";
import { emptyGraph, parseGraph } from "@/lib/workflows/graph";
import { createWorkflow, listWorkflows } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

function serializeSummary(workflow: Awaited<ReturnType<typeof listWorkflows>>[number]) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    isEnabled: workflow.isEnabled,
    serverSlugs: workflow.serverSlugs,
    graphVersion: workflow.graphVersion,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const workflows = await listWorkflows(user.id);
  return Response.json({ workflows: workflows.map(serializeSummary) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "A name is required." }, { status: 400 });
  }

  const parsed =
    body.graph === undefined ? { success: true as const, data: emptyGraph() } : parseGraph(body.graph);
  if (!parsed.success) {
    return Response.json(
      { error: "The graph is invalid.", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const workflow = await createWorkflow(user.id, {
    name,
    description:
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null,
    graph: parsed.data,
  });

  return Response.json({ workflow: { ...serializeSummary(workflow), graph: parsed.data } }, { status: 201 });
}
