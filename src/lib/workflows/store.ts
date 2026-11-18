import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RunStatus, WorkflowTrigger } from "@/generated/prisma/enums";
import {
  CURRENT_GRAPH_VERSION,
  collectServerSlugs,
  parseGraph,
  type WorkflowGraph,
} from "@/lib/workflows/graph";
import { ScheduleError, assertValidRunAt, nextRunAt } from "@/lib/workflows/schedule";
import { mintWebhookSecret } from "@/lib/workflows/webhook";

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
  runAt: true,
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
  /** Required when trigger is ONCE, ignored otherwise. */
  runAt?: Date | null;
  /** IANA zone for `cron` or `runAt`; required with either. */
  timezone?: string | null;
  /** Replace the webhook URL. Ignored unless the trigger is WEBHOOK. */
  rotateWebhook?: boolean;
  versionNote?: string | null;
};

type ResolvedSchedule = {
  cron: string | null;
  timezone: string | null;
  runAt: Date | null;
  nextRunAt: Date | null;
};

/**
 * Works out the schedule columns from a trigger and its cron or run time.
 *
 * Kept in one place so the columns cannot disagree: a MANUAL workflow with a
 * leftover `nextRunAt` would be picked up by the scheduler and run on a
 * schedule the user thought they had removed.
 */
function resolveSchedule(
  trigger: WorkflowTrigger,
  cron: string | null | undefined,
  timezone: string | null | undefined,
  runAt: Date | null | undefined,
  from: Date = new Date(),
): ResolvedSchedule {
  if (trigger === "ONCE") {
    if (!runAt || !timezone) {
      throw new ScheduleError("A one-time workflow needs a date, a time and a timezone.");
    }
    assertValidRunAt(runAt, timezone, from);
    return { cron: null, timezone, runAt, nextRunAt: runAt };
  }

  if (trigger !== "SCHEDULE") {
    return { cron: null, timezone: null, runAt: null, nextRunAt: null };
  }

  if (!cron || !timezone) {
    throw new ScheduleError(
      "A SCHEDULE workflow needs both a cron expression and a timezone.",
    );
  }

  // Throws on a malformed expression or an unknown zone, so an invalid
  // schedule fails at save time rather than silently never firing.
  return { cron, timezone, runAt: null, nextRunAt: nextRunAt(cron, timezone, from) };
}

export type WorkflowVersionSummary = {
  id: string;
  revision: number;
  note: string | null;
  createdAt: Date;
};

export function listVersions(
  userId: string,
  workflowId: string,
): Promise<WorkflowVersionSummary[]> {
  return prisma.workflowVersion.findMany({
    where: { workflowId, workflow: { userId } },
    select: { id: true, revision: true, note: true, createdAt: true },
    orderBy: { revision: "desc" },
  });
}

/** A version as the studio receives it. */
export type WorkflowVersionView = Omit<WorkflowVersionSummary, "createdAt"> & {
  createdAt: string;
};

export function versionView(version: WorkflowVersionSummary): WorkflowVersionView {
  return {
    id: version.id,
    revision: version.revision,
    note: version.note,
    createdAt: version.createdAt.toISOString(),
  };
}

export function getVersion(userId: string, workflowId: string, revision: number) {
  return prisma.workflowVersion.findFirst({
    where: { workflowId, revision, workflow: { userId } },
  });
}

export function createWorkflow(userId: string, input: WorkflowInput) {
  const trigger = input.trigger ?? "MANUAL";
  // Outside the transaction on purpose: an invalid cron should fail before a
  // transaction is opened, not roll one back.
  const schedule = resolveSchedule(
    trigger,
    input.cron,
    input.timezone,
    input.runAt,
  );

  return prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
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
        webhookSecret: trigger === "WEBHOOK" ? mintWebhookSecret() : undefined,
        ...schedule,
      },
    });

    await tx.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        revision: 1,
        graph: input.graph as unknown as Prisma.InputJsonValue,
        graphVersion: CURRENT_GRAPH_VERSION,
        note: input.versionNote ?? "Created",
      },
    });

    return workflow;
  });
}

/**
 * Returns null if the workflow is missing or not owned by `userId`.
 * Graph saves append a WorkflowVersion row; name-only edits do not.
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

  // Computed before the transaction so an invalid cron aborts without having
  // opened one.
  const trigger = input.trigger ?? current.trigger;
  const touchesSchedule =
    input.trigger !== undefined ||
    input.cron !== undefined ||
    input.timezone !== undefined ||
    input.runAt !== undefined ||
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
        input.runAt !== undefined ? input.runAt : current.runAt,
      ),
    );
  }

  if (input.rotateWebhook) {
    if (trigger !== "WEBHOOK") {
      throw new ScheduleError("Only a webhook workflow has a URL to rotate.");
    }
    data.webhookSecret = mintWebhookSecret();
  } else if (trigger === "WEBHOOK" && !current.webhookSecret) {
    data.webhookSecret = mintWebhookSecret();
  }

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.workflow.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return null;

    await tx.workflow.update({ where: { id }, data });

    if (input.graph !== undefined) {
      const last = await tx.workflowVersion.findFirst({
        where: { workflowId: id },
        orderBy: { revision: "desc" },
        select: { revision: true },
      });

      await tx.workflowVersion.create({
        data: {
          workflowId: id,
          revision: (last?.revision ?? 0) + 1,
          graph: input.graph as unknown as Prisma.InputJsonValue,
          graphVersion: CURRENT_GRAPH_VERSION,
          note: input.versionNote ?? null,
        },
      });
    }

    return tx.workflow.findFirst({ where: { id, userId } });
  });

  return updated;
}

/**
 * Copies an earlier snapshot onto the working graph and appends a new
 * revision. History rows are never rewritten.
 */
export async function restoreWorkflowVersion(
  userId: string,
  workflowId: string,
  revision: number,
) {
  const version = await getVersion(userId, workflowId, revision);
  if (!version) return null;

  const parsed = parseGraph(version.graph);
  if (!parsed.success) return null;

  return updateWorkflow(userId, workflowId, {
    graph: parsed.data,
    versionNote: `Restored from v${revision}`,
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
 * Queues a run for the Go worker (worker/); the QUEUED row is the whole
 * handoff. The graph is snapshotted so later edits do not rewrite what this
 * run did.
 */
export async function enqueueRun(
  userId: string,
  workflowId: string,
  trigger: WorkflowTrigger,
  options: { dryRun?: boolean; input?: unknown } = {},
) {
  const workflow = await getWorkflow(userId, workflowId);
  if (!workflow) return null;

  return prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      status: "QUEUED",
      trigger,
      dryRun: options.dryRun ?? false,
      input:
        options.input === undefined
          ? undefined
          : (options.input as Prisma.InputJsonValue),
      graphSnapshot: workflow.graph as Prisma.InputJsonValue,
      graphVersion: workflow.graphVersion,
    },
  });
}

export type WebhookLookup = "unknown" | "disabled" | "ok";

export async function lookupWebhook(secret: string): Promise<WebhookLookup> {
  const workflow = await prisma.workflow.findFirst({
    where: { webhookSecret: secret, trigger: "WEBHOOK" },
    select: { isEnabled: true },
  });
  if (!workflow) return "unknown";
  if (!workflow.isEnabled) return "disabled";
  return "ok";
}

export type WebhookEnqueueResult =
  | { kind: "unknown" }
  | { kind: "disabled" }
  | { kind: "queued"; runId: string };

/**
 * Public webhook ingest. Auth is the unguessable secret in the URL, not a
 * session: the caller is GitHub, Stripe, a form, not the workflow's owner.
 */
export async function enqueueWebhookRun(
  secret: string,
  input: unknown,
): Promise<WebhookEnqueueResult> {
  const workflow = await prisma.workflow.findFirst({
    where: { webhookSecret: secret, trigger: "WEBHOOK" },
    select: {
      id: true,
      isEnabled: true,
      graph: true,
      graphVersion: true,
    },
  });
  if (!workflow) return { kind: "unknown" };
  if (!workflow.isEnabled) return { kind: "disabled" };

  const now = new Date();
  const [run] = await prisma.$transaction([
    prisma.workflowRun.create({
      data: {
        workflowId: workflow.id,
        status: "QUEUED",
        trigger: "WEBHOOK",
        input: input as Prisma.InputJsonValue,
        graphSnapshot: workflow.graph as Prisma.InputJsonValue,
        graphVersion: workflow.graphVersion,
      },
      select: { id: true },
    }),
    prisma.workflow.update({
      where: { id: workflow.id },
      data: { lastRunAt: now },
    }),
  ]);

  return { kind: "queued", runId: run.id };
}

/** One run with its steps in execution order. Ownership-scoped via the join. */
export function getRun(userId: string, runId: string) {
  return prisma.workflowRun.findFirst({
    where: { id: runId, workflow: { userId } },
    include: { stepRuns: { orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }] } },
  });
}

export function isFinished(status: RunStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
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
