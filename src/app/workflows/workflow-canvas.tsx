"use client";

import { useCallback, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { McpServerView } from "@/lib/mcp/servers";
import {
  edgeId,
  flowToGraph,
  graphToFlow,
  newNodeId,
  type FlowEdge,
  type FlowNode,
} from "@/lib/workflows/flow";
import type { WorkflowGraph } from "@/lib/workflows/graph";
import { BranchNode, ToolNode, TriggerNode } from "./workflow-nodes";

const nodeTypes = {
  trigger: TriggerNode,
  tool: ToolNode,
  branch: BranchNode,
};

type MenuState = {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
};

export function WorkflowCanvas({
  graph,
  connections,
  onChange,
}: {
  graph: WorkflowGraph;
  connections: McpServerView[];
  onChange: (graph: WorkflowGraph) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const initial = graphToFlow(graph);

  // Local state is the source of truth while editing. Deriving nodes from
  // `graph` on every parent render let React Flow's measure/select
  // onNodesChange commit the *previous* node list and erase a node that had
  // just been added in the same click.
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const graphRef = useRef(graph);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  graphRef.current = graph;

  const emit = useCallback(
    (nextNodes: FlowNode[], nextEdges: FlowEdge[]) => {
      onChange(flowToGraph(nextNodes, nextEdges, graphRef.current));
    },
    [onChange],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        nodesRef.current = next;
        if (changes.some(isGraphMutatingNodeChange)) {
          emit(next, edgesRef.current);
        }
        return next;
      });
    },
    [emit],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      setEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        edgesRef.current = next;
        emit(nodesRef.current, next);
        return next;
      });
    },
    [emit],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      if (
        edgesRef.current.some(
          (edge) =>
            edge.source === connection.source && edge.target === connection.target,
        )
      ) {
        return;
      }

      setEdges((current) => {
        const next = addEdge(
          {
            ...connection,
            id: edgeId(connection.source!, connection.target!),
            data: { when: "always" as const },
          },
          current,
        );
        edgesRef.current = next;
        emit(nodesRef.current, next);
        return next;
      });
    },
    [emit],
  );

  function addConnectionNode(server: McpServerView) {
    if (!menu) return;

    const node: FlowNode = {
      id: newNodeId(),
      type: "tool",
      position: { x: menu.flowX, y: menu.flowY },
      data: {
        kind: "tool",
        label: server.name,
        serverSlug: server.slug,
        toolSlug: "action",
      },
    };

    setNodes((current) => {
      const next = [...current, node];
      nodesRef.current = next;
      emit(next, edgesRef.current);
      return next;
    });
    setMenu(null);
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => setMenu(null)}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const flow = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          setMenu({
            x: event.clientX,
            y: event.clientY,
            flowX: flow.x,
            flowY: flow.y,
          });
        }}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background />
        <Controls />
      </ReactFlow>

      {menu ? (
        <div
          className="fixed z-50 w-64 overflow-hidden rounded-xl border border-[#ebebeb] bg-white shadow-lg dark:border-[#1a1a1a] dark:bg-neutral-950"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="px-3 py-2 text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
            Add node
          </p>
          {connections.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-[#666] dark:text-[#999]">
              No connections yet. Connect a tool under Integrations first.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto pb-1">
              {connections.map((server) => (
                <li key={server.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a]"
                    onClick={() => addConnectionNode(server)}
                  >
                    <span className="text-sm text-black dark:text-[#ededed]">
                      {server.name}
                    </span>
                    {server.connection?.accountLabel ? (
                      <span className="text-xs text-[#666] dark:text-[#999]">
                        {server.connection.accountLabel}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function isGraphMutatingNodeChange(change: NodeChange<FlowNode>) {
  return (
    change.type === "add" ||
    change.type === "remove" ||
    change.type === "replace" ||
    change.type === "position"
  );
}
