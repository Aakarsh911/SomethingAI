"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
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
import { BranchNode, LlmNode, ToolNode, TriggerNode } from "./workflow-nodes";

const nodeTypes = {
  trigger: TriggerNode,
  tool: ToolNode,
  llm: LlmNode,
  branch: BranchNode,
};

const MENU_RESULT_LIMIT = 5;

type PaneMenuState = {
  kind: "pane";
  x: number;
  y: number;
  flowX: number;
  flowY: number;
};

type NodeMenuState = {
  kind: "node";
  x: number;
  y: number;
  nodeId: string;
  label: string;
};

type EdgeMenuState = {
  kind: "edge";
  x: number;
  y: number;
  edgeId: string;
};

type MenuState = PaneMenuState | NodeMenuState | EdgeMenuState;

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

  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [connectionSearch, setConnectionSearch] = useState("");

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const graphRef = useRef(graph);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    graphRef.current = graph;
  }, [edges, graph, nodes]);

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
        if (changes.some((change) => change.type === "remove")) {
          emit(nodesRef.current, next);
        }
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

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => {
        const next = current.filter((node) => node.id !== nodeId);
        nodesRef.current = next;
        setEdges((edgeCurrent) => {
          const nextEdges = edgeCurrent.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId,
          );
          edgesRef.current = nextEdges;
          emit(next, nextEdges);
          return nextEdges;
        });
        return next;
      });
      setMenu(null);
    },
    [emit],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((current) => {
        const next = current.filter((edge) => edge.id !== id);
        edgesRef.current = next;
        emit(nodesRef.current, next);
        return next;
      });
      setMenu(null);
    },
    [emit],
  );

  function addConnectionNode(server: McpServerView) {
    if (menu?.kind !== "pane") return;

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

  const filteredConnections = useMemo(() => {
    const query = connectionSearch.trim().toLowerCase();
    const ranked = connections.filter((server) => {
      if (!query) return true;
      const haystack = [
        server.name,
        server.slug,
        server.connection?.accountLabel ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
    return ranked.slice(0, MENU_RESULT_LIMIT);
  }, [connectionSearch, connections]);

  const totalMatches = useMemo(() => {
    const query = connectionSearch.trim().toLowerCase();
    if (!query) return connections.length;
    return connections.filter((server) => {
      const haystack = [
        server.name,
        server.slug,
        server.connection?.accountLabel ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    }).length;
  }, [connectionSearch, connections]);

  return (
    <div className="relative h-full w-full bg-[#fafafa] dark:bg-[#0a0a0a]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
        <p className="rounded-full border border-[#ebebeb]/80 bg-white/90 px-3 py-1 text-xs text-[#666] shadow-sm backdrop-blur dark:border-[#262626] dark:bg-neutral-950/90 dark:text-[#999]">
          Right-click empty canvas to add · Right-click node or connection to delete ·
          Select and press Delete
        </p>
      </div>

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
          setConnectionSearch("");
          setMenu({
            kind: "pane",
            x: event.clientX,
            y: event.clientY,
            flowX: flow.x,
            flowY: flow.y,
          });
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (node.deletable === false) return;
          setMenu({
            kind: "node",
            x: event.clientX,
            y: event.clientY,
            nodeId: node.id,
            label: node.data.label,
          });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          setMenu({
            kind: "edge",
            x: event.clientX,
            y: event.clientY,
            edgeId: edge.id,
          });
        }}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        elementsSelectable
        defaultEdgeOptions={{
          style: { stroke: "#a3a3a3", strokeWidth: 2 },
          className: "hover:!stroke-neutral-900 dark:hover:!stroke-[#ededed]",
        }}
      >
        <Background gap={20} size={1} color="#e5e5e5" />
        <Controls className="!rounded-xl !border-[#ebebeb] !shadow-md dark:!border-[#262626] dark:!bg-neutral-950" />
        <MiniMap
          className="!rounded-xl !border-[#ebebeb] !shadow-md dark:!border-[#262626] dark:!bg-neutral-950"
          maskColor="rgb(0 0 0 / 0.08)"
        />
      </ReactFlow>

      {menu ? (
        <div
          className="fixed z-50 w-72 overflow-hidden rounded-xl border border-[#ebebeb] bg-white shadow-xl dark:border-[#262626] dark:bg-neutral-950"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {menu.kind === "pane" ? (
            <>
              <div className="border-b border-[#ebebeb] px-3 py-2 dark:border-[#262626]">
                <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
                  Add connection
                </p>
                <input
                  type="search"
                  autoFocus
                  value={connectionSearch}
                  onChange={(event) => setConnectionSearch(event.target.value)}
                  placeholder="Search integrations…"
                  className="mt-2 h-8 w-full rounded-lg border border-[#ebebeb] bg-[#fafafa] px-2.5 text-sm text-black outline-none placeholder:text-[#999] focus:border-neutral-400 dark:border-[#262626] dark:bg-[#141414] dark:text-[#ededed]"
                />
              </div>
              {connections.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[#666] dark:text-[#999]">
                  No connections yet. Connect a tool under Integrations first.
                </p>
              ) : filteredConnections.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[#666] dark:text-[#999]">
                  No matches for “{connectionSearch.trim()}”.
                </p>
              ) : (
                <>
                  <ul className="py-1">
                    {filteredConnections.map((server) => (
                      <li key={server.id}>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full flex-col items-start px-3 py-2.5 text-left transition hover:bg-[#f5f5f5] dark:hover:bg-[#1a1a1a]"
                          onClick={() => addConnectionNode(server)}
                        >
                          <span className="text-sm font-medium text-black dark:text-[#ededed]">
                            {server.name}
                          </span>
                          {server.connection?.accountLabel ? (
                            <span className="text-xs text-[#666] dark:text-[#999]">
                              {server.connection.accountLabel}
                            </span>
                          ) : (
                            <span className="font-mono text-xs text-[#999] dark:text-[#666]">
                              {server.slug}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {totalMatches > MENU_RESULT_LIMIT ? (
                    <p className="border-t border-[#ebebeb] px-3 py-2 text-xs text-[#999] dark:border-[#262626] dark:text-[#666]">
                      {totalMatches - MENU_RESULT_LIMIT} more — refine your search
                    </p>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {menu.kind === "node" ? (
            <div className="p-2">
              <p className="px-2 py-1 text-xs text-[#666] dark:text-[#999]">
                {menu.label}
              </p>
              <button
                type="button"
                role="menuitem"
                className="flex w-full rounded-lg px-2 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => deleteNode(menu.nodeId)}
              >
                Delete node
              </button>
            </div>
          ) : null}

          {menu.kind === "edge" ? (
            <div className="p-2">
              <p className="px-2 py-1 text-xs text-[#666] dark:text-[#999]">
                Connection
              </p>
              <button
                type="button"
                role="menuitem"
                className="flex w-full rounded-lg px-2 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => deleteEdge(menu.edgeId)}
              >
                Delete connection
              </button>
            </div>
          ) : null}
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
