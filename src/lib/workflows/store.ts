import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RunStatus, WorkflowTrigger } from "@/generated/prisma/enums";
import {
  CURRENT_GRAPH_VERSION,
  collectServerSlugs,
  parseGraph,
  type WorkflowGraph,
} from "@/lib/workflows/graph";

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
  versionNote?: string | null;
};

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

export function getVersion(userId: string, workflowId: string, revision: number) {
  return prisma.workflowVersion.findFirst({
    where: { workflowId, revision, workflow: { userId } },
  });
}

export function createWorkflow(userId: string, input: WorkflowInput) {
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
        trigger: input.trigger ?? "MANUAL",
        isEnabled: input.isEnabled ?? false,
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
  const data: Prisma.WorkflowUpdateManyMutationInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.trigger !== undefined) data.trigger = input.trigger;
  if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
  if (input.graph !== undefined) {
    data.graph = input.graph as unknown as Prisma.InputJsonValue;
    data.graphVersion = CURRENT_GRAPH_VERSION;
    data.serverSlugs = collectServerSlugs(input.graph);
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
