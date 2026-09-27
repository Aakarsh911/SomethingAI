"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/workflows/flow";

const shell =
  "min-w-[200px] rounded-xl border bg-white px-3.5 py-3 shadow-sm transition dark:bg-neutral-950";

export function TriggerNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-neutral-900 dark:border-[#ededed]`}>
      <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
        Trigger
      </p>
      <p className="mt-0.5 text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-neutral-900 dark:!border-neutral-950 dark:!bg-[#ededed]"
      />
    </div>
  );
}

export function ToolNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-[#e5e5e5] dark:border-[#262626]`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-neutral-900 dark:!border-neutral-950 dark:!bg-[#ededed]"
      />
      <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
        Connection
      </p>
      <p className="mt-0.5 text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      {data.serverSlug ? (
        <p className="mt-1 font-mono text-[11px] text-[#999] dark:text-[#666]">{data.serverSlug}</p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-neutral-900 dark:!border-neutral-950 dark:!bg-[#ededed]"
      />
    </div>
  );
}

export function LlmNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-violet-600 dark:!border-neutral-950 dark:!bg-violet-400"
      />
      <p className="text-[10px] font-semibold tracking-wide text-violet-700 uppercase dark:text-violet-300">
        Model
      </p>
      <p className="mt-0.5 text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      {data.instruction ? (
        <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-[#666] dark:text-[#999]">
          {data.instruction}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-violet-600 dark:!border-neutral-950 dark:!bg-violet-400"
      />
    </div>
  );
}

export function BranchNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-amber-600 dark:!border-neutral-950 dark:!bg-amber-400"
      />
      <p className="text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
        Branch
      </p>
      <p className="mt-0.5 text-sm font-medium text-black dark:text-[#ededed]">{data.label}</p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-amber-600 dark:!border-neutral-950 dark:!bg-amber-400"
      />
    </div>
  );
}
