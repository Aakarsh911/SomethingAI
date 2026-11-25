"use client";

import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

type StepRun = {
  nodeId: string;
  status: RunStatus;
  serverSlug: string | null;
  toolSlug: string | null;
  error: string | null;
  output: unknown;
};

type DashboardRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  trigger: string;
  error: string | null;
  output: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  stepCount: number;
  steps: StepRun[];
};

function getStatusColor(status: RunStatus): string {
  switch (status) {
    case "SUCCEEDED":
      return "bg-g-green";
    case "FAILED":
    case "CANCELED":
      return "bg-g-red";
    case "RUNNING":
      return "bg-g-blue";
    case "QUEUED":
      return "bg-muted-foreground";
  }
}

function getStatusTextColor(status: RunStatus): string {
  switch (status) {
    case "SUCCEEDED":
      return "text-g-green";
    case "FAILED":
    case "CANCELED":
      return "text-g-red";
    case "RUNNING":
      return "text-g-blue";
    case "QUEUED":
      return "text-muted-foreground";
  }
}

function getStatusBgColor(status: RunStatus): string {
  switch (status) {
    case "SUCCEEDED":
      return "bg-g-green/8 border-g-green/20";
    case "FAILED":
    case "CANCELED":
      return "bg-g-red/8 border-g-red/20";
    case "RUNNING":
      return "bg-g-blue/8 border-g-blue/20";
    case "QUEUED":
      return "bg-muted/50 border-muted-foreground/20";
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "not started";
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const duration = Math.round(
    (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000,
  );
  if (duration < 60) return `${duration}s`;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}m ${seconds}s`;
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

function getOutputSize(output: unknown): number {
  if (typeof output === "string") return output.length;
  return JSON.stringify(output).length;
}

function truncateOutput(output: unknown, maxChars: number = 100): string {
  const str = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + "...";
}

function isGmailOutput(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  const obj = output as Record<string, unknown>;
  return "messages" in obj && Array.isArray(obj.messages);
}

function formatGmailOutput(output: unknown): React.ReactNode {
  const obj = output as { messages: Array<{ subject?: string; preview?: { body?: string; subject?: string }; sender?: string; messageTimestamp?: string }> };
  const messages = obj.messages || [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {messages.length} email{messages.length !== 1 ? "s" : ""}
      </p>
      {messages.slice(0, 3).map((msg, idx) => (
        <div key={idx} className="rounded border border-border bg-card p-2">
          <p className="text-xs font-medium">{msg.subject || msg.preview?.subject || "No subject"}</p>
          {msg.preview?.body && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {msg.preview.body}
            </p>
          )}
        </div>
      ))}
      {messages.length > 3 && (
        <p className="text-xs text-muted-foreground">
          + {messages.length - 3} more
        </p>
      )}
    </div>
  );
}

function isSimpleObject(output: unknown): boolean {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return false;
  const obj = output as Record<string, unknown>;
  return Object.keys(obj).length <= 5;
}

function formatSimpleObject(output: unknown): React.ReactNode {
  const obj = output as Record<string, unknown>;
  return (
    <div className="space-y-1">
      {Object.entries(obj).map(([key, value]) => (
        <div key={key} className="text-xs">
          <span className="font-medium text-muted-foreground">{key}:</span>{" "}
          <span>{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardView({ runs: initialRuns }: { runs: DashboardRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [showRawOutput, setShowRawOutput] = useState<Set<string>>(new Set());

  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const toggleRawOutput = (outputId: string) => {
    setShowRawOutput((prev) => {
      const next = new Set(prev);
      if (next.has(outputId)) {
        next.delete(outputId);
      } else {
        next.add(outputId);
      }
      return next;
    });
  };

  useEffect(() => {
    const hasActive = runs.some((r) => r.status === "RUNNING" || r.status === "QUEUED");
    if (!hasActive) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/runs");
        if (response.ok) {
          const data = (await response.json()) as { runs: DashboardRun[] };
          setRuns(data.runs);
        }
      } catch (error) {
        console.error("Failed to refresh runs:", error);
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [runs]);

  const stats = {
    total: runs.length,
    succeeded: runs.filter((r) => r.status === "SUCCEEDED").length,
    failed: runs.filter((r) => r.status === "FAILED" || r.status === "CANCELED").length,
    running: runs.filter((r) => r.status === "RUNNING").length,
    queued: runs.filter((r) => r.status === "QUEUED").length,
  };

  // Group runs by day for the chart
  const runsByDay = React.useMemo(() => {
    const groups = new Map<string, { succeeded: number; failed: number; total: number }>();

    runs.forEach((run) => {
      const date = new Date(run.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });

      const existing = groups.get(date) || { succeeded: 0, failed: 0, total: 0 };
      existing.total++;
      if (run.status === "SUCCEEDED") existing.succeeded++;
      if (run.status === "FAILED" || run.status === "CANCELED") existing.failed++;
      groups.set(date, existing);
    });

    return Array.from(groups.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .slice(-7); // Last 7 days
  }, [runs]);

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.16em] text-brand uppercase">
              Overview
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Dashboard</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Workflow run history and performance metrics
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-ok" />
              {stats.succeeded} succeeded
            </span>
            <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              {stats.total} total runs
            </span>
          </div>
        </div>

        {runsByDay.length > 0 && (
          <div className="mb-8 rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-sm font-medium text-foreground">Activity (Last 7 Days)</h2>
            <div className="flex items-end justify-between gap-2 h-32">
              {runsByDay.map((day, idx) => {
                const maxHeight = Math.max(...runsByDay.map((d) => d.total));
                const height = (day.total / maxHeight) * 100;
                const successRate = day.total > 0 ? (day.succeeded / day.total) * 100 : 0;

                return (
                  <div key={idx} className="flex flex-1 flex-col items-center gap-2">
                    <div className="relative w-full h-16 flex flex-col-reverse gap-0.5">
                      {day.succeeded > 0 && (
                        <div
                          className="w-full rounded-t bg-g-green transition-all hover:opacity-80"
                          style={{ height: `${(day.succeeded / maxHeight) * 64}px` }}
                          title={`${day.succeeded} succeeded`}
                        />
                      )}
                      {day.failed > 0 && (
                        <div
                          className="w-full rounded-t bg-g-red transition-all hover:opacity-80"
                          style={{ height: `${(day.failed / maxHeight) * 64}px` }}
                          title={`${day.failed} failed`}
                        />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-medium">{day.total}</p>
                      <p className="text-[10px] text-muted-foreground">{day.date}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded-[2px] bg-g-green" />
                <span className="text-muted-foreground">Succeeded</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded-[2px] bg-g-red" />
                <span className="text-muted-foreground">Failed</span>
              </div>
            </div>
          </div>
        )}

        {runs.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No runs yet. Create a workflow and run it to see results here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => {
              const duration = formatDuration(run.startedAt, run.finishedAt);
              const isExpanded = expandedRuns.has(run.id);
              const hasDetails = run.output || run.steps.length > 0;

              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-border bg-card/50 backdrop-blur-sm transition-colors"
                >
                  <div
                    className={cn(
                      "flex items-start justify-between gap-3 px-4 py-3",
                      hasDetails && "cursor-pointer hover:bg-card",
                    )}
                    onClick={hasDetails ? () => toggleRun(run.id) : undefined}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {hasDetails && (
                        <button
                          className="mt-0.5 shrink-0 text-muted-foreground transition-transform"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRun(run.id);
                          }}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/workflows/${run.workflowId}`}
                            className="truncate text-sm font-medium text-foreground hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {run.workflowName}
                          </Link>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium",
                              getStatusBgColor(run.status),
                              getStatusTextColor(run.status),
                            )}
                          >
                            {run.status.toLowerCase()}
                          </span>
                          <span>{relativeTime(run.finishedAt ?? run.startedAt)}</span>
                          {duration && <span>{duration}</span>}
                          {run.stepCount > 0 && <span>{run.stepCount} steps</span>}
                          <span className="capitalize">{run.trigger.toLowerCase()}</span>
                        </div>
                        {run.error && !isExpanded && (
                          <p className="mt-2 truncate text-xs text-g-red" title={run.error}>
                            {run.error}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {isExpanded && hasDetails && (
                    <div className="border-t border-border bg-muted/20 px-4 py-4">
                      {run.error && (
                        <div className="mb-3">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            Error
                          </p>
                          <p className="text-xs text-g-red">{run.error}</p>
                        </div>
                      )}
                      {run.output != null && (
                        <div className="mb-3">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            Output
                          </p>
                          {(() => {
                            const outputId = `${run.id}-output`;
                            const showRaw = showRawOutput.has(outputId);
                            const isGmail = isGmailOutput(run.output);
                            const isSimple = isSimpleObject(run.output);
                            const isString = typeof run.output === "string";
                            const outputSize = getOutputSize(run.output);
                            const isLarge = outputSize > 1000;

                            return (
                              <>
                                {!showRaw && (isGmail || isSimple) ? (
                                  <div className="rounded-md bg-muted/50 p-3">
                                    {isGmail ? formatGmailOutput(run.output) : formatSimpleObject(run.output)}
                                  </div>
                                ) : (
                                  <>
                                    {isLarge && !showRaw && (
                                      <p className="mb-1 text-xs text-muted-foreground">
                                        {outputSize.toLocaleString()} characters
                                      </p>
                                    )}
                                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-card px-3 py-2 text-xs font-mono">
                                      {showRaw || !isLarge ? formatOutput(run.output) : truncateOutput(run.output)}
                                    </pre>
                                  </>
                                )}
                                {(!isString || isLarge) && (
                                  <button
                                    onClick={() => toggleRawOutput(outputId)}
                                    className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    {showRaw ? "Show less" : isLarge ? `Show full (${outputSize.toLocaleString()} chars)` : "Show raw"}
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {run.steps.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-medium text-muted-foreground">
                            Steps ({run.steps.length})
                          </p>
                          <div className="space-y-2">
                            {run.steps.map((step, idx) => (
                              <div
                                key={step.nodeId}
                                className="rounded-md border border-border/50 bg-background/50 px-3 py-2.5"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">
                                    {idx + 1}.
                                  </span>
                                  <span className="font-mono text-xs">
                                    {step.toolSlug ?? "LLM Chatbot"}
                                  </span>
                                  <span
                                    className={cn(
                                      "ml-auto text-xs",
                                      getStatusTextColor(step.status),
                                    )}
                                  >
                                    {step.status.toLowerCase()}
                                  </span>
                                </div>
                                {step.error && (
                                  <p className="mt-1 text-xs text-g-red">{step.error}</p>
                                )}
                                {step.output != null && (
                                  <div className="mt-2">
                                    {(() => {
                                      const outputId = `${run.id}-${step.nodeId}`;
                                      const showRaw = showRawOutput.has(outputId);
                                      const isGmail = isGmailOutput(step.output);
                                      const isSimple = isSimpleObject(step.output);
                                      const isString = typeof step.output === "string";
                                      const outputSize = getOutputSize(step.output);
                                      const isLarge = outputSize > 1000;

                                      return (
                                        <>
                                          {!showRaw && (isGmail || isSimple) ? (
                                            <div className="rounded bg-muted/50 p-2">
                                              {isGmail ? formatGmailOutput(step.output) : formatSimpleObject(step.output)}
                                            </div>
                                          ) : (
                                            <>
                                              {isLarge && !showRaw && (
                                                <p className="mb-1 text-xs text-muted-foreground">
                                                  {outputSize.toLocaleString()} characters
                                                </p>
                                              )}
                                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 text-[11px] font-mono">
                                                {showRaw || !isLarge ? formatOutput(step.output) : truncateOutput(step.output)}
                                              </pre>
                                            </>
                                          )}
                                          {(!isString || isLarge) && (
                                            <button
                                              onClick={() => toggleRawOutput(outputId)}
                                              className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                                            >
                                              {showRaw ? "Show less" : isLarge ? `Show full (${outputSize.toLocaleString()} chars)` : "Show raw"}
                                            </button>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
