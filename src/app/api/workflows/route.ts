import { getCurrentUser, unauthorized } from "@/lib/auth";
import { emptyGraph, parseGraph } from "@/lib/workflows/graph";
import { ScheduleError } from "@/lib/workflows/schedule";
import { createWorkflow, listWorkflows } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

function serializeSummary(workflow: Awaited<ReturnType<typeof listWorkflows>>[number]) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    isEnabled: workflow.isEnabled,
    cron: workflow.cron,
    timezone: workflow.timezone,
    nextRunAt: workflow.nextRunAt?.toISOString() ?? null,
    lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
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

/**
 * Creates a workflow, either empty from the studio or from a confirmed draft
 * off /workflows/new.
 *
 * The graph is re-validated rather than trusted: a generated draft made a
 * round trip through the browser, so whatever comes back is user input
 * regardless of where it originated.
 */
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

  // The studio creates a blank workflow with no graph; the chat builder always
  // sends one.
  const parsed =
    body.graph === undefined
      ? { success: true as const, data: emptyGraph() }
      : parseGraph(body.graph);
  if (!parsed.success) {
    return Response.json(
      { error: "The graph is invalid.", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const trigger = body.trigger === "SCHEDULE" ? "SCHEDULE" : "MANUAL";

  try {
    const workflow = await createWorkflow(user.id, {
      name: name.slice(0, 120),
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim().slice(0, 2000)
          : null,
      graph: parsed.data,
      trigger,
      cron: typeof body.cron === "string" ? body.cron : null,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
      // Always saved off. Enabling is a separate, deliberate act — a workflow
      // generated from one sentence should not start firing on a schedule
      // before anyone has looked at it.
      isEnabled: false,
    });

    return Response.json(
      { workflow: { ...serializeSummary(workflow), graph: parsed.data } },
      { status: 201 },
    );
  } catch (error) {
    // A bad cron or unknown timezone is the caller's problem to fix, so it
    // comes back as a 422 with the explanation rather than a 500.
    if (error instanceof ScheduleError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
