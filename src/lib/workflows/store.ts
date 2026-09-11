import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RunStatus, WorkflowTrigger } from "@/generated/prisma/enums";
import {
  CURRENT_GRAPH_VERSION,
  collectServerSlugs,
  type WorkflowGraph,
} from "@/lib/workflows/graph";
import { ScheduleError, nextRunAt } from "@/lib/workflows/schedule";

/**
 * Persistence for workflows and their run history.
 *
 * Every function takes `userId` and scopes on it. Ownership is enforced here,
 * in the query, rather than being left to the caller to remember — a route
 * that forgets the check should come back empty, not with someone else's
 * workflow.
 *
 * `userId` is the local User.id, not the Clerk id. Routes resolve one to the
 * other; this layer deliberately imports no auth so it stays testable without
 * a session.
 *
 * One JSONB quirk worth knowing before you build on this: Postgres does not
 * preserve object key order (it sorts keys by length, then bytewise), so a
 * graph read back is deep-equal to what was written but not string-equal.
 * Dirty-checking an editor with `JSON.stringify(a) !== JSON.stringify(b)`
 * will report a change on every load — compare with a deep equality check, or
 * stringify both sides with recursively sorted keys.
 */

/** Enough to render a list without shipping every graph blob to the client. */
const summaryFields = {
  id: true,
  name: true,
  description: true,
  trigger: true,
  isEnabled: true,
  cron: true,
  timezone: true,
  nextRunAt: true,
  lastRunAt: true,
  serverSlugs: true,
  graphVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkflowSelect;

export type WorkflowSummary = Prisma.WorkflowGetPayload<{
  select: typeof summaryFields;
}>;

export function listWorkflows(userId: string): Promise<WorkflowSummary[]> {
  return prisma.workflow.findMany({
    where: { userId },
    select: summaryFields,
    orderBy: { updatedAt: "desc" },
  });
}

/** Returns null when the workflow does not exist *or* belongs to someone else. */
export function getWorkflow(userId: string, id: string) {
  return prisma.workflow.findFirst({ where: { id, userId } });
}

export type WorkflowInput = {
  name: string;
  description?: string | null;
  graph: WorkflowGraph;
  trigger?: WorkflowTrigger;
  isEnabled?: boolean;
  /** Required when trigger is SCHEDULE, ignored otherwise. */
  cron?: string | null;
  /** IANA zone the cron is read in. Required alongside `cron`. */
  timezone?: string | null;
};

type ResolvedSchedule = {
  cron: string | null;
  timezone: string | null;
  nextRunAt: Date | null;
};

/**
 * Works out the three schedule columns from a trigger and a cron.
 *
 * Kept in one place so the columns cannot disagree: a MANUAL workflow with a
 * leftover `nextRunAt` would be picked up by the scheduler and run on a
 * schedule the user thought they had removed.
 */
function resolveSchedule(
  trigger: WorkflowTrigger,
  cron: string | null | undefined,
  timezone: string | null | undefined,
  from: Date = new Date(),
): ResolvedSchedule {
  if (trigger !== "SCHEDULE") {
    return { cron: null, timezone: null, nextRunAt: null };
  }

  if (!cron || !timezone) {
    throw new ScheduleError(
      "A SCHEDULE workflow needs both a cron expression and a timezone.",
    );
  }

  // Throws on a malformed expression or an unknown zone, so an invalid
  // schedule fails at save time rather than silently never firing.
  return { cron, timezone, nextRunAt: nextRunAt(cron, timezone, from) };
}

export function createWorkflow(userId: string, input: WorkflowInput) {
  const trigger = input.trigger ?? "MANUAL";
  const schedule = resolveSchedule(trigger, input.cron, input.timezone);

  return prisma.workflow.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      graph: input.graph as unknown as Prisma.InputJsonValue,
      graphVersion: CURRENT_GRAPH_VERSION,
      // Derived from the graph rather than accepted from the caller, so the
      // column cannot drift out of sync with the blob it summarises.
      serverSlugs: collectServerSlugs(input.graph),
      trigger,
      isEnabled: input.isEnabled ?? false,
      ...schedule,
    },
  });
}

/**
 * Returns null if the workflow is missing or not owned by `userId`.
 *
 * `updateMany` rather than `update`: it filters on non-unique columns without
 * relying on extended-where-unique, and a mismatched owner yields count 0
 * instead of an exception that has to be distinguished from a real fault.
 */
export async function updateWorkflow(
  userId: string,
  id: string,
  input: Partial<WorkflowInput>,
) {
  const current = await getWorkflow(userId, id);
  if (!current) return null;

  const data: Prisma.WorkflowUpdateManyMutationInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
  if (input.graph !== undefined) {
    data.graph = input.graph as unknown as Prisma.InputJsonValue;
    data.graphVersion = CURRENT_GRAPH_VERSION;
    data.serverSlugs = collectServerSlugs(input.graph);
  }

  const trigger = input.trigger ?? current.trigger;
  const touchesSchedule =
    input.trigger !== undefined ||
    input.cron !== undefined ||
    input.timezone !== undefined ||
    // Re-enabling recomputes too: a workflow disabled for a week has a
    // nextRunAt in the past, which would otherwise fire the moment it is
    // switched back on.
    (input.isEnabled === true && !current.isEnabled);

  if (touchesSchedule) {
    data.trigger = trigger;
    Object.assign(
      data,
      resolveSchedule(
        trigger,
        input.cron !== undefined ? input.cron : current.cron,
        input.timezone !== undefined ? input.timezone : current.timezone,
      ),
    );
  }

  const { count } = await prisma.workflow.updateMany({
    where: { id, userId },
    data,
  });

  return count === 0 ? null : getWorkflow(userId, id);
}

/**
 * Enabled workflows whose next run is due, oldest first.
 *
 * Not user-scoped — this is the scheduler's query, and it runs for everyone.
 * It is the only function here that crosses user boundaries, which is why it
 * takes no userId rather than taking one and ignoring it.
 */
export function dueWorkflows(now: Date = new Date(), take = 100) {
  return prisma.workflow.findMany({
    where: { isEnabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take,
  });
}

/**
 * Records that a scheduled workflow just ran and advances its next due time.
 *
 * `nextRunAt` is computed forward from now rather than from the previous
 * value, so a workflow that was paused, or a worker that fell behind, catches
 * up to the next future occurrence instead of firing repeatedly to work
 * through every slot it missed.
 */
export async function markScheduledRun(workflowId: string, ranAt = new Date()) {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) return null;

  const next =
    workflow.trigger === "SCHEDULE" && workflow.cron && workflow.timezone
      ? nextRunAt(workflow.cron, workflow.timezone, ranAt)
      : null;

  return prisma.workflow.update({
    where: { id: workflowId },
    data: { lastRunAt: ranAt, nextRunAt: next },
  });
}

/** True if a row was removed. Runs and step runs cascade. */
export async function deleteWorkflow(userId: string, id: string) {
  const { count } = await prisma.workflow.deleteMany({ where: { id, userId } });
  return count > 0;
}

/**
 * Workflows that reference an MCP server, for warning a user before they
 * disconnect it. Uses the GIN index on `serverSlugs`.
 */
export function workflowsUsingServer(
  userId: string,
  serverSlug: string,
): Promise<WorkflowSummary[]> {
  return prisma.workflow.findMany({
    where: { userId, serverSlugs: { has: serverSlug } },
    select: summaryFields,
    orderBy: { name: "asc" },
  });
}

/**
 * Opens a run and snapshots the graph as it stands right now.
 *
 * The snapshot is the point of this function: without it, editing a workflow
 * silently rewrites what every earlier run appears to have done.
 */
export async function startRun(
  userId: string,
  workflowId: string,
  trigger: WorkflowTrigger,
) {
  const workflow = await getWorkflow(userId, workflowId);
  if (!workflow) return null;

  return prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      status: "RUNNING",
      trigger,
      graphSnapshot: workflow.graph as Prisma.InputJsonValue,
      graphVersion: workflow.graphVersion,
      startedAt: new Date(),
    },
  });
}

export function finishRun(
  runId: string,
  status: Extract<RunStatus, "SUCCEEDED" | "FAILED" | "CANCELED">,
  error?: string,
) {
  return prisma.workflowRun.update({
    where: { id: runId },
    data: { status, error: error ?? null, finishedAt: new Date() },
  });
}

/**
 * Records the outcome of one attempt at one node.
 *
 * Retries append a new row rather than overwriting, so a flaky step keeps its
 * full history; `@@unique([runId, nodeId, attempt])` makes a double-write of
 * the same attempt a constraint error instead of a silent duplicate.
 */
export function recordStepRun(input: {
  runId: string;
  nodeId: string;
  attempt?: number;
  status: RunStatus;
  serverSlug?: string | null;
  toolSlug?: string | null;
  stepInput?: unknown;
  output?: unknown;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  return prisma.workflowStepRun.create({
    data: {
      runId: input.runId,
      nodeId: input.nodeId,
      attempt: input.attempt ?? 1,
      status: input.status,
      serverSlug: input.serverSlug ?? null,
      toolSlug: input.toolSlug ?? null,
      input: (input.stepInput ?? null) as Prisma.InputJsonValue,
      output: (input.output ?? null) as Prisma.InputJsonValue,
      error: input.error ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

/** Recent runs for a workflow, newest first. Ownership-scoped via the join. */
export function listRuns(userId: string, workflowId: string, take = 20) {
  return prisma.workflowRun.findMany({
    where: { workflowId, workflow: { userId } },
    orderBy: { createdAt: "desc" },
    take,
    include: { stepRuns: { orderBy: { createdAt: "asc" } } },
  });
}
