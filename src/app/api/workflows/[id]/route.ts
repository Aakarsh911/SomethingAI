import { getCurrentUser, unauthorized } from "@/lib/auth";
import { parseGraph } from "@/lib/workflows/graph";
import { ScheduleError } from "@/lib/workflows/schedule";
import {
  deleteWorkflow,
  getWorkflow,
  listVersions,
  updateWorkflow,
} from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

function serialize(workflow: NonNullable<Awaited<ReturnType<typeof getWorkflow>>>) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    isEnabled: workflow.isEnabled,
    cron: workflow.cron,
    timezone: workflow.timezone,
    runAt: workflow.runAt?.toISOString() ?? null,
    nextRunAt: workflow.nextRunAt?.toISOString() ?? null,
    lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
    serverSlugs: workflow.serverSlugs,
    graphVersion: workflow.graphVersion,
    graph: workflow.graph,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const workflow = await getWorkflow(user.id, id);
  if (!workflow) {
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  }

  const versions = await listVersions(user.id, id);
  return Response.json({
    workflow: serialize(workflow),
    versions: versions.map((version) => ({
      id: version.id,
      revision: version.revision,
      note: version.note,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { id } = await params;
  const input: Parameters<typeof updateWorkflow>[2] = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return Response.json({ error: "A name is required." }, { status: 400 });
    }
    input.name = name;
  }

  if (body.description !== undefined) {
    input.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }

  if (body.graph !== undefined) {
    const parsed = parseGraph(body.graph);
    if (!parsed.success) {
      return Response.json(
        { error: "The graph is invalid.", issues: parsed.error.issues },
        { status: 422 },
      );
    }
    input.graph = parsed.data;
    if (typeof body.versionNote === "string" && body.versionNote.trim()) {
      input.versionNote = body.versionNote.trim();
    }
  }

  if (body.trigger !== undefined) {
    if (
      body.trigger !== "MANUAL" &&
      body.trigger !== "SCHEDULE" &&
      body.trigger !== "ONCE"
    ) {
      return Response.json(
        { error: "Trigger must be MANUAL, SCHEDULE or ONCE." },
        { status: 400 },
      );
    }
    input.trigger = body.trigger;
  }
  if (body.cron !== undefined) {
    input.cron = typeof body.cron === "string" && body.cron.trim() ? body.cron.trim() : null;
  }
  if (body.timezone !== undefined) {
    input.timezone =
      typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : null;
  }
  if (body.runAt !== undefined) {
    // An ISO instant from the browser, already converted out of local time
    // there. Validity and "not in the past" are checked by the store.
    input.runAt = typeof body.runAt === "string" ? new Date(body.runAt) : null;
  }
  if (body.isEnabled !== undefined) {
    if (typeof body.isEnabled !== "boolean") {
      return Response.json({ error: "isEnabled must be a boolean." }, { status: 400 });
    }
    input.isEnabled = body.isEnabled;
  }

  let workflow;
  try {
    workflow = await updateWorkflow(user.id, id, input);
  } catch (error) {
    // A bad cron, a past run time or an unknown zone is the caller's to fix.
    if (error instanceof ScheduleError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
  if (!workflow) {
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  }

  const versions = await listVersions(user.id, id);
  return Response.json({
    workflow: serialize(workflow),
    versions: versions.map((version) => ({
      id: version.id,
      revision: version.revision,
      note: version.note,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const removed = await deleteWorkflow(user.id, id);
  if (!removed) {
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
