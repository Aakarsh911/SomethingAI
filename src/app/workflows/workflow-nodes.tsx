"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/workflows/flow";

const shell =
  "min-w-[180px] rounded-xl border bg-white px-3 py-2 shadow-sm dark:bg-neutral-950";

export function TriggerNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-neutral-900 dark:border-[#ededed]`}>
      <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
        Trigger
      </p>
      <p className="text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !bg-neutral-900 dark:!bg-[#ededed]"
      />
    </div>
  );
}

export function ToolNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-[#ebebeb] dark:border-[#1a1a1a]`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !bg-neutral-900 dark:!bg-[#ededed]"
      />
      <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
        Connection
      </p>
      <p className="text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      {data.serverSlug ? (
        <p className="font-mono text-xs text-[#999] dark:text-[#666]">{data.serverSlug}</p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !bg-neutral-900 dark:!bg-[#ededed]"
      />
    </div>
  );
}

export function LlmNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-violet-300 dark:border-violet-900`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !bg-neutral-900 dark:!bg-[#ededed]"
      />
      <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
        Model
      </p>
      <p className="text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      {/* The instruction is the whole behaviour of this node, so show it here
          rather than leaving the card indistinguishable from any other step. */}
      {data.instruction ? (
        <p className="mt-0.5 max-w-[220px] text-xs text-[#666] dark:text-[#999]">
          {data.instruction}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !bg-neutral-900 dark:!bg-[#ededed]"
      />
    </div>
  );
}

export function BranchNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-amber-300 dark:border-amber-800`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !bg-neutral-900 dark:!bg-[#ededed]"
      />
      <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
        Branch
      </p>
      <p className="text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !bg-neutral-900 dark:!bg-[#ededed]"
      />
    </div>
  );
}
