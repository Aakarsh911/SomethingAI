"use client";

import { useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot, Clock, Plug, Workflow } from "lucide-react";
import type { FlowNode } from "@/lib/workflows/flow";
import { isUnconfiguredTool } from "@/lib/workflows/graph";
import { ScheduleContext, summarizeSchedule } from "./schedule-context";

const shell =
  "relative min-w-[220px] overflow-hidden rounded-2xl border px-3.5 py-3 shadow-[0_12px_32px_-18px_rgb(0_0_0/0.35)] backdrop-blur-xl transition";

const handleClass =
  "!h-2.5 !w-2.5 !border-2 !border-card !bg-foreground";

function Badge({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof Clock;
  label: string;
  className: string;
}) {
  return (
    <p className={`flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase ${className}`}>
      <Icon className="size-3" />
      {label}
    </p>
  );
}

export function TriggerNode({ data }: NodeProps<FlowNode>) {
  const schedule = useContext(ScheduleContext);
  const summary = schedule ? summarizeSchedule(schedule) : null;

  return (
    <div className={`${shell} border-g-blue/30 bg-card/90`}>
      <span className="absolute inset-y-0 left-0 w-1 bg-g-blue" />
      <Badge icon={Clock} label="Trigger" className="text-g-blue" />
      <p className="mt-1 text-sm font-medium text-foreground">{data.label}</p>
      {summary ? (
        <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-muted-foreground">
          {summary.text}
          {summary.off ? (
            <span className="text-[color:var(--warn)]"> · Off</span>
          ) : null}
        </p>
      ) : null}
      <p className="mt-1.5 text-[10px] text-subtle">Click to schedule</p>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

export function ToolNode({ data }: NodeProps<FlowNode>) {
  const unconfigured = isUnconfiguredTool(data.toolSlug);

  return (
    <div
      className={`${shell} ${
        unconfigured
          ? "border-dashed border-g-yellow bg-g-yellow/10"
          : "border-g-green/30 bg-g-green/8"
      }`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${unconfigured ? "bg-g-yellow" : "bg-g-green"}`}
      />
      <Handle type="target" position={Position.Left} className={`${handleClass} !bg-g-green`} />
      <Badge
        icon={Plug}
        label={data.serverSlug ?? "Connection"}
        className={unconfigured ? "text-[color:var(--warn)]" : "text-g-green"}
      />
      <p className="mt-1 text-sm font-medium text-foreground">{data.label}</p>
      {unconfigured ? (
        <p className="mt-1 text-xs text-[color:var(--warn)]">Click to choose a tool</p>
      ) : (
        <p className="mt-1 max-w-[240px] truncate font-mono text-[11px] text-subtle">
          {data.toolSlug}
        </p>
      )}
      <Handle type="source" position={Position.Right} className={`${handleClass} !bg-g-green`} />
    </div>
  );
}

export function LlmNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-g-yellow/70 bg-g-yellow/12`}>
      <span className="absolute inset-y-0 left-0 w-1 bg-g-yellow" />
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-g-yellow"
      />
      <Badge icon={Bot} label="Model" className="text-[color:var(--warn)]" />
      <p className="mt-1 text-sm font-medium text-foreground">{data.label}</p>
      {data.instruction ? (
        <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-muted-foreground">
          {data.instruction}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-g-yellow"
      />
    </div>
  );
}

export function BranchNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${shell} border-g-red/30 bg-g-red/8`}>
      <span className="absolute inset-y-0 left-0 w-1 bg-g-red" />
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-g-red"
      />
      <Badge icon={Workflow} label="Branch" className="text-g-red" />
      <p className="mt-1 text-sm font-medium text-foreground">{data.label}</p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-g-red"
      />
    </div>
  );
}
