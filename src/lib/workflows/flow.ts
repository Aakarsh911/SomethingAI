import type { Edge, Node } from "@xyflow/react";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "@/lib/workflows/graph";

export type FlowNodeData = {
  kind: WorkflowNode["kind"];
  label: string;
  serverSlug?: string;
  toolSlug?: string;
  /**
   * Carried through the canvas so a round trip keeps it. An llm node whose
   * instruction is lost is indistinguishable from a trigger on the way back,
   * and the graph then fails validation with two triggers.
   */
  instruction?: string;
};

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge<{ when: WorkflowEdge["when"] }>;

export function graphToFlow(graph: WorkflowGraph): {
  nodes: FlowNode[];
  edges: FlowEdge[];
} {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.kind,
      position: node.position,
      data: {
        kind: node.kind,
        label: node.label ?? defaultLabel(node),
        serverSlug: node.kind === "tool" ? node.serverSlug : undefined,
        toolSlug: node.kind === "tool" ? node.toolSlug : undefined,
        instruction: node.kind === "llm" ? node.instruction : undefined,
      },
      deletable: node.kind !== "trigger",
    })),
    edges: graph.edges.map((edge) => ({
      id: edgeId(edge.from, edge.to, edge.when),
      source: edge.from,
      target: edge.to,
      data: { when: edge.when },
    })),
  };
}

export function flowToGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  previous: WorkflowGraph,
): WorkflowGraph {
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));

  return {
    nodes: nodes.map((node) => {
      const existing = previousById.get(node.id);
      const label = node.data.label;
      const position = { x: node.position.x, y: node.position.y };

      if (existing?.kind === "tool" || node.data.kind === "tool") {
        return {
          id: node.id,
          kind: "tool" as const,
          label,
          position,
          serverSlug:
            node.data.serverSlug ??
            (existing && existing.kind === "tool" ? existing.serverSlug : "unknown"),
          toolSlug:
            node.data.toolSlug ??
            (existing && existing.kind === "tool" ? existing.toolSlug : "action"),
          inputs: existing && existing.kind === "tool" ? existing.inputs : {},
        };
      }

      if (existing?.kind === "branch" || node.data.kind === "branch") {
        return {
          id: node.id,
          kind: "branch" as const,
          label,
          position,
          condition: existing && existing.kind === "branch" ? existing.condition : "true",
        };
      }

      if (existing?.kind === "llm" || node.data.kind === "llm") {
        return {
          id: node.id,
          kind: "llm" as const,
          label,
          position,
          // The schema requires a non-empty instruction, so fall back to the
          // label rather than emitting a node the save would reject.
          instruction:
            node.data.instruction ??
            (existing && existing.kind === "llm" ? existing.instruction : undefined) ??
            label,
        };
      }

      return {
        id: node.id,
        kind: "trigger" as const,
        label,
        position,
        config: existing && existing.kind === "trigger" ? existing.config : {},
      };
    }),
    edges: edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      when: edge.data?.when ?? "always",
    })),
  };
}

export function edgeId(from: string, to: string, when: WorkflowEdge["when"] = "always") {
  return `${from}__${to}__${when}`;
}

function defaultLabel(node: WorkflowNode): string {
  if (node.kind === "tool") return node.serverSlug;
  if (node.kind === "llm") return "Model step";
  if (node.kind === "branch") return "Branch";
  return "When started";
}

export function newNodeId(): string {
  return `n_${crypto.randomUUID().replaceAll("-", "")}`;
}
