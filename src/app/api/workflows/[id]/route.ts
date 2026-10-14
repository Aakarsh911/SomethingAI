import { z } from "zod";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { parseGraph } from "@/lib/workflows/graph";
import {
  ScheduleError,
  USER_TRIGGERS,
  scheduleView,
} from "@/lib/workflows/schedule";
import {
  deleteWorkflow,
  getWorkflow,
  listVersions,
  updateWorkflow,
  versionView,
} from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

/** Blank text means "clear it". */
const optionalText = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable()
  .optional();

/** Validity of the cron, zone and run time is checked by the store. */
const schedulePatch = z.object({
  trigger: z.enum(USER_TRIGGERS).optional(),
  cron: optionalText,
  timezone: optionalText,
  runAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .nullable()
    .optional(),
  isEnabled: z.boolean().optional(),
});

function serialize(workflow: NonNullable<Awaited<ReturnType<typeof getWorkflow>>>) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    isEnabled: workflow.isEnabled,
    schedule: scheduleView(workflow),
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
    versions: versions.map(versionView),
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

  const schedule = schedulePatch.safeParse(body);
  if (!schedule.success) {
    return Response.json(
      { error: "The schedule is invalid.", issues: schedule.error.issues },
      { status: 400 },
    );
  }

  let workflow;
  try {
    workflow = await updateWorkflow(user.id, id, { ...input, ...schedule.data });
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
    versions: versions.map(versionView),
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
