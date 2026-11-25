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

type TimeRange = "7d" | "30d" | "90d" | "ytd";

export function DashboardView({ runs: initialRuns }: { runs: DashboardRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [showRawOutput, setShowRawOutput] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");

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

  // Group runs by day or month for the chart
  const runsByDay = React.useMemo(() => {
    const now = new Date();
    const groups = new Map<string, { succeeded: number; failed: number; total: number }>();

    if (timeRange === "ytd") {
      // Group by month for YTD
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      // Fill all months from Jan to current month
      for (let month = 0; month <= currentMonth; month++) {
        const date = new Date(currentYear, month, 1);
        const monthStr = date.toLocaleDateString('en-US', { month: 'short' });
        groups.set(monthStr, { succeeded: 0, failed: 0, total: 0 });
      }

      // Count runs by month
      runs.forEach((run) => {
        const runDate = new Date(run.createdAt);
        if (runDate.getFullYear() === currentYear) {
          const monthStr = runDate.toLocaleDateString('en-US', { month: 'short' });
          const existing = groups.get(monthStr);
          if (existing) {
            existing.total++;
            if (run.status === "SUCCEEDED") existing.succeeded++;
            if (run.status === "FAILED" || run.status === "CANCELED") existing.failed++;
          }
        }
      });
    } else {
      // Group by day for 7D, 30D, 90D
      const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;

      // Fill in all days with 0 counts
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
        groups.set(dateStr, { succeeded: 0, failed: 0, total: 0 });
      }

      // Count actual runs
      const nowTime = now.getTime();
      runs.forEach((run) => {
        const runDate = new Date(run.createdAt);
        const daysDiff = Math.floor((nowTime - runDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff < days) {
          const dateStr = runDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          });

          const existing = groups.get(dateStr);
          if (existing) {
            existing.total++;
            if (run.status === "SUCCEEDED") existing.succeeded++;
            if (run.status === "FAILED" || run.status === "CANCELED") existing.failed++;
          }
        }
      });
    }

    return Array.from(groups.entries()).map(([date, counts]) => ({ date, ...counts }));
  }, [runs, timeRange]);

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Dashboard</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              
            </span> */}
          </div>
        </div>

        {runsByDay.length > 0 && (
          <div className="mb-8 rounded-lg border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground">Activity</h2>
              <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
                <button
                  onClick={() => setTimeRange("7d")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    timeRange === "7d"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  7D
                </button>
                <button
                  onClick={() => setTimeRange("30d")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    timeRange === "30d"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  30D
                </button>
                <button
                  onClick={() => setTimeRange("90d")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    timeRange === "90d"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  90D
                </button>
                <button
                  onClick={() => setTimeRange("ytd")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    timeRange === "ytd"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  YTD
                </button>
              </div>
            </div>
            <div className={cn(
              "flex items-end justify-center h-32",
              timeRange === "7d" || timeRange === "30d" ? "gap-2" : timeRange === "90d" ? "gap-0.5" : "gap-2"
            )}>
              {(timeRange === "ytd" ? runsByDay : runsByDay.slice(timeRange === "7d" ? -7 : timeRange === "30d" ? -30 : -90)).map((day, idx) => {
                const maxHeight = Math.max(1, ...runsByDay.map((d) => d.total));
                return (
                  <div key={idx} className="flex flex-col items-center gap-2 shrink-0">
                    <div className={cn(
                      "relative h-16 flex flex-col-reverse items-center",
                      timeRange === "7d" ? "w-12" : timeRange === "30d" ? "w-6" : timeRange === "90d" ? "w-1.5" : "w-12"
                    )}>
                      {day.succeeded > 0 && (
                        <div
                          className="w-full bg-g-green transition-all hover:opacity-80"
                          style={{
                            height: `${(day.succeeded / maxHeight) * 64}px`,
                            borderTopLeftRadius: day.failed === 0 ? '0.25rem' : 0,
                            borderTopRightRadius: day.failed === 0 ? '0.25rem' : 0
                          }}
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
                      {day.total > 0 && (timeRange === "7d" || timeRange === "30d" || timeRange === "ytd") && (
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-background pointer-events-none">
                          {day.total}
                        </span>
                      )}
                    </div>
                    <div className="text-center">
                      {(timeRange === "7d" || timeRange === "ytd") && (
                        <p className="text-[10px] text-muted-foreground">{day.date}</p>
                      )}
                      {timeRange === "30d" && (idx % 5 === 0 || idx === runsByDay.length - 1) && (
                        <p className="text-[10px] text-muted-foreground whitespace-nowrap">{day.date}</p>
                      )}
                      {timeRange === "90d" && (idx % 15 === 0 || idx === runsByDay.length - 1) && (
                        <p className="text-[10px] text-muted-foreground whitespace-nowrap">{day.date}</p>
                      )}
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
          <>
            <div className="text-2xl font-semibold my-5">
              Run History
            </div>
            <div className="my-5">
              {stats.total} total runs
            </div>
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
            </div></>

        )}
      </main>
    </div>
  );
}
