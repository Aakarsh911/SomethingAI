import { getCurrentUser, unauthorized } from "@/lib/auth";
import { parseGraph } from "@/lib/workflows/graph";
import { ScheduleError } from "@/lib/workflows/schedule";
import { createWorkflow, listWorkflows } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return Response.json({ workflows: await listWorkflows(user.id) });
}

/**
 * Saves a confirmed draft.
 *
 * The graph is re-validated here rather than trusted: the draft made a round
 * trip through the browser, so whatever comes back is user input regardless
 * of where it originated.
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
    return Response.json({ error: "A workflow needs a name." }, { status: 400 });
  }

  const graph = parseGraph(body.graph);
  if (!graph.success) {
    return Response.json(
      {
        error: "That workflow is not valid.",
        issues: graph.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  const trigger = body.trigger === "SCHEDULE" ? "SCHEDULE" : "MANUAL";

  try {
    const workflow = await createWorkflow(user.id, {
      name: name.slice(0, 120),
      description:
        typeof body.description === "string" ? body.description.slice(0, 2000) : null,
      graph: graph.data,
      trigger,
      cron: typeof body.cron === "string" ? body.cron : null,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
      // Always saved off. Enabling is a separate, deliberate act — a workflow
      // generated from one sentence should not start firing on a schedule
      // before anyone has looked at it.
      isEnabled: false,
    });

    return Response.json({ workflow }, { status: 201 });
  } catch (error) {
    if (error instanceof ScheduleError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
