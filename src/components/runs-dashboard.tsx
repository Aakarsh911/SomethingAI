"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

type RunItem = {
  id: string;
  status: RunStatus;
  trigger: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  steps: Array<{
    nodeId: string;
    status: RunStatus;
    error: string | null;
  }>;
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

export function RunsDashboard({ workflowId }: { workflowId: string }) {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRuns() {
      try {
        const response = await fetch(`/api/workflows/${workflowId}/run`);
        if (response.ok) {
          const data = await response.json() as { runs: RunItem[] };
          setRuns(data.runs);
        }
      } catch (error) {
        console.error("Failed to fetch runs:", error);
      } finally {
        setLoading(false);
      }
    }

    void fetchRuns();
    // Refresh every 10 seconds if there are running/queued runs
    const hasActive = runs.some((r) => r.status === "RUNNING" || r.status === "QUEUED");
    if (hasActive) {
      const interval = setInterval(() => void fetchRuns(), 10_000);
      return () => clearInterval(interval);
    }
  }, [workflowId, runs]);

  if (loading) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">Loading runs...</div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No runs yet. Click &rdquo;Run now&rdquo; to execute this workflow.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {runs.map((run) => {
        const duration =
          run.startedAt && run.finishedAt
            ? Math.round(
              (new Date(run.finishedAt).getTime() -
                new Date(run.startedAt).getTime()) /
              1000,
            )
            : null;

        return (
          <div
            key={run.id}
            className="border-b border-border px-4 py-2.5 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={cn("size-1.5 rounded-full shrink-0", getStatusColor(run.status))}
                />
                <span className={cn("text-xs font-medium truncate", getStatusTextColor(run.status))}>
                  {run.status.toLowerCase()}
                </span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {relativeTime(run.finishedAt ?? run.startedAt)}
              </span>
            </div>
            {run.error && (
              <p className="mt-1 text-xs text-g-red truncate" title={run.error}>
                {run.error}
              </p>
            )}
            {duration !== null && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {duration}s
                {run.steps.length > 0 && ` · ${run.steps.length} steps`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
