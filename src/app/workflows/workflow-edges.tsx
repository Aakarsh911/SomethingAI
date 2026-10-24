"use client";

import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { FlowEdge } from "@/lib/workflows/flow";

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps<FlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const gradId = `wf-edge-${id}`;

  return (
    <>
      <defs>
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor="var(--g-blue)" />
          <stop offset="100%" stopColor="var(--g-green)" />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: selected ? 2.5 : 1.75,
        }}
      />
    </>
  );
}
