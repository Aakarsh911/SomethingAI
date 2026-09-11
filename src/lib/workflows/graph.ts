import { z } from "zod";

/**
 * The workflow graph is stored as a JSONB blob (see the `Workflow.graph`
 * comment in prisma/schema.prisma for why). Postgres therefore enforces
 * nothing about its contents, so this file is the only thing keeping malformed
 * graphs out of the database — every write path must go through
 * `parseGraph` before touching Prisma.
 */

/** Bumped when the blob's shape changes incompatibly. Stored per row. */
export const CURRENT_GRAPH_VERSION = 1;

const nodeId = z
  .string()
  .min(1)
  .max(128)
  // Node ids end up in WorkflowStepRun.nodeId and in the run detail URL, so
  // keep them to a conservative character set rather than accepting any string.
  .regex(/^[A-Za-z0-9_-]+$/, "Node ids may only contain letters, digits, - and _");

/**
 * Calls a tool on a connected MCP server.
 *
 * `serverSlug` references McpServer.slug rather than its id. Ids are per
 * database, so a blob carrying one would not survive a seed rebuild or a
 * restore into a different environment; slugs are stable and globally unique.
 * Nothing here checks that the server exists — that is a connection-time
 * concern, and a graph naming a server the user has not connected yet is a
 * legitimate draft.
 */
const toolNode = z.object({
  id: nodeId,
  kind: z.literal("tool"),
  label: z.string().max(200).optional(),
  serverSlug: z.string().min(1).max(128),
  toolSlug: z.string().min(1).max(200),
  /** Argument template. Placeholders are resolved by the executor, not here. */
  inputs: z.record(z.string(), z.unknown()).default({}),
});

/** Entry point. Exactly one per graph. */
const triggerNode = z.object({
  id: nodeId,
  kind: z.literal("trigger"),
  label: z.string().max(200).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

/** Routes to different edges based on a condition the executor evaluates. */
const branchNode = z.object({
  id: nodeId,
  kind: z.literal("branch"),
  label: z.string().max(200).optional(),
  condition: z.string().max(2000),
});

const node = z.discriminatedUnion("kind", [triggerNode, toolNode, branchNode]);

const edge = z.object({
  from: nodeId,
  to: nodeId,
  /** Which branch this edge represents; only meaningful out of a branch node. */
  when: z.enum(["always", "true", "false"]).default("always"),
});

export const graphSchema = z
  .object({
    nodes: z.array(node).max(200),
    edges: z.array(edge).max(400),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (ids.has(n.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `Duplicate node id "${n.id}".`,
        });
      }
      ids.add(n.id);
    }

    // Dangling edges would surface as a null-reference crash mid-run, long
    // after the user saved. Cheaper to reject at the boundary.
    for (const [i, e] of graph.edges.entries()) {
      if (!ids.has(e.from)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", i, "from"],
          message: `Edge references unknown node "${e.from}".`,
        });
      }
      if (!ids.has(e.to)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", i, "to"],
          message: `Edge references unknown node "${e.to}".`,
        });
      }
    }

    const triggers = graph.nodes.filter((n) => n.kind === "trigger");
    if (triggers.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: `A workflow needs exactly one trigger node, found ${triggers.length}.`,
      });
    }
  });

export type WorkflowGraph = z.infer<typeof graphSchema>;
export type WorkflowNode = z.infer<typeof node>;

/**
 * Validates an untrusted value as a graph.
 *
 * Returns a result rather than throwing so callers can map failures onto a
 * 422 with field paths intact, instead of turning every malformed draft into
 * a 500.
 */
export function parseGraph(value: unknown) {
  return graphSchema.safeParse(value);
}

/**
 * Every distinct MCP server slug the graph references.
 *
 * Persisted to `Workflow.serverSlugs` on save so "which workflows use Gmail?"
 * is an indexed lookup rather than a scan that parses every blob.
 */
export function collectServerSlugs(graph: WorkflowGraph): string[] {
  const slugs = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind === "tool") slugs.add(n.serverSlug);
  }
  return [...slugs].sort();
}
