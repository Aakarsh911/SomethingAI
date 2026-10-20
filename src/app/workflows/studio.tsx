"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Sparkles, Trash2 } from "lucide-react";
import AITextLoading from "@/components/kokonutui/ai-text-loading";
import HoldButton from "@/components/kokonutui/hold-button";
import ParticleButton from "@/components/kokonutui/particle-button";
import {
  StatusIsland,
  type IslandTask,
} from "@/components/kokonutui/status-island";
import type { McpServerView } from "@/lib/mcp/servers";
import { cn } from "@/lib/utils";
import { isUnconfiguredTool, type WorkflowGraph } from "@/lib/workflows/graph";
import type { RunSummary } from "@/lib/workflows/runtime";
import type { WorkflowSchedule } from "@/lib/workflows/schedule";
import type { WorkflowVersionView } from "@/lib/workflows/store";
import { requestJson } from "./request-json";
import { ScheduleContext } from "./schedule-context";
import type { SchedulePatch } from "./schedule-inspector";
import { fieldClass, primaryButtonClass, secondaryButtonClass } from "./styles";
import { WorkflowCanvas } from "./workflow-canvas";

export type WorkflowListItem = {
  id: string;
  name: string;
  updatedAt: string;
};

export type WorkflowDetail = WorkflowListItem & {
  description: string | null;
  graph: WorkflowGraph;
  schedule: WorkflowSchedule;
};

/** A finished run, remembering whether it was a test so the banner can say so. */
type RunResult = RunSummary & { dryRun: boolean };

/** What saving or restoring the graph answers with. */
type SavedGraph = {
  workflow: { graph: WorkflowGraph };
  versions: WorkflowVersionView[];
};

type ModificationQuestion = {
  id: string;
  question: string;
  why: string;
  suggestion: string | null;
};

type ModificationMessage = {
  role: "user" | "assistant";
  content: string;
};

export function WorkflowStudio(props: {
  workflows: WorkflowListItem[];
  selected: WorkflowDetail | null;
  versions: WorkflowVersionView[];
  connections: McpServerView[];
}) {
  // Remount when the selected workflow changes so local graph state is
  // initialized from props instead of synced in an effect.
  return <StudioInner key={props.selected?.id ?? "none"} {...props} />;
}

function StudioInner({
  workflows,
  selected,
  versions,
  connections,
}: {
  workflows: WorkflowListItem[];
  selected: WorkflowDetail | null;
  versions: WorkflowVersionView[];
  connections: McpServerView[];
}) {
  const router = useRouter();
  const [nameDraft, setNameDraft] = useState("");
  const [displayName, setDisplayName] = useState(selected?.name ?? "");
  const [graph, setGraph] = useState<WorkflowGraph | null>(selected?.graph ?? null);
  const [schedule, setSchedule] = useState<WorkflowSchedule | null>(
    selected?.schedule ?? null,
  );
  const [localVersions, setLocalVersions] = useState(versions);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkflowListItem | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [modification, setModification] = useState("");
  const [modificationMessages, setModificationMessages] = useState<
    ModificationMessage[]
  >([]);
  const [modificationQuestions, setModificationQuestions] = useState<
    ModificationQuestion[]
  >([]);
  const [modifying, setModifying] = useState(false);
  const [modificationFeedback, setModificationFeedback] = useState<string | null>(
    null,
  );
  const [running, setRunning] = useState<false | "dry" | "live">(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef<string>(selected ? stableStringify(selected.graph) : "");

  // Tool steps with no tool chosen; live runs are blocked until there are none.
  const unconfigured = (graph?.nodes ?? [])
    .filter((node) => node.kind === "tool" && isUnconfiguredTool(node.toolSlug))
    .map((node) => node.label ?? node.id);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  async function createWorkflow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nameDraft.trim();
    if (!name) return;

    setError(null);
    const result = await requestJson<{ workflow: { id: string } }>("/api/workflows", {
      method: "POST",
      body: { name },
      fallback: "Could not create the workflow.",
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setNameDraft("");
    router.push(`/workflows/${result.data.workflow.id}`);
    router.refresh();
  }

  async function persistGraph(next: WorkflowGraph): Promise<boolean> {
    if (!selected) return false;
    const serialized = stableStringify(next);
    if (serialized === lastSaved.current) return true;

    setSaveState("saving");
    const result = await requestJson<SavedGraph>(`/api/workflows/${selected.id}`, {
      method: "PATCH",
      body: { graph: next },
      fallback: "Could not save the workflow.",
    });
    if (!result.ok) {
      setSaveState("error");
      setError(result.error);
      return false;
    }

    lastSaved.current = stableStringify(result.data.workflow.graph);
    setLocalVersions(result.data.versions);
    setSaveState("saved");
    router.refresh();
    return true;
  }

  function queueSave(next: WorkflowGraph) {
    setGraph(next);
    setError(null);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistGraph(next);
    }, 800);
  }

  /** Resolves to an error message for the panel, or null once saved. */
  async function saveSchedule(patch: SchedulePatch): Promise<string | null> {
    if (!selected) return "No workflow selected.";

    const result = await requestJson<{ workflow: { schedule: WorkflowSchedule } }>(
      `/api/workflows/${selected.id}`,
      { method: "PATCH", body: patch, fallback: "Could not save the schedule." },
    );
    if (!result.ok) return result.error;

    setSchedule(result.data.workflow.schedule);
    router.refresh();
    return null;
  }

  async function restore(revision: number) {
    if (!selected) return;
    setError(null);
    const result = await requestJson<SavedGraph>(
      `/api/workflows/${selected.id}/versions/${revision}/restore`,
      { method: "POST", fallback: "Could not restore that version." },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setGraph(result.data.workflow.graph);
    setCanvasKey((value) => value + 1);
    lastSaved.current = stableStringify(result.data.workflow.graph);
    setLocalVersions(result.data.versions);
    setSaveState("saved");
    router.refresh();
  }

  async function modifyWorkflow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !graph || modifying) return;

    const instruction = modification.trim();
    if (!instruction) return;

    setModifying(true);

    // The model must edit the same graph the user can see. Flush a pending
    // drag/add/delete before the server loads the workflow as its baseline.
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const saved = await persistGraph(graph);
    if (!saved) {
      setModifying(false);
      return;
    }

    const messages: ModificationMessage[] = [
      ...modificationMessages,
      { role: "user", content: instruction },
    ];
    setModification("");
    setModificationQuestions([]);
    setModificationFeedback(null);
    setError(null);

    // The endpoint answers with either clarifying questions or the new workflow.
    const result = await requestJson<{
      questions?: ModificationQuestion[];
      workflow?: { name: string; graph: WorkflowGraph; schedule: WorkflowSchedule };
      versions?: WorkflowVersionView[];
      droppedArgs?: string[];
    }>(`/api/workflows/${selected.id}/modify`, {
      method: "POST",
      body: { messages, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      fallback: "Could not change the workflow.",
    });
    setModifying(false);

    // On failure the conversation so far is kept, so a retry still carries it.
    if (!result.ok) {
      setError(result.error);
      setModificationMessages(messages);
      return;
    }

    const { questions, workflow, versions, droppedArgs = [] } = result.data;
    if (questions?.length) {
      const assistantMessage = questions
        .map((question) => `- (${question.id}) ${question.question}`)
        .join("\n");
      setModificationMessages([...messages, { role: "assistant", content: assistantMessage }]);
      setModificationQuestions(questions);
      return;
    }
    if (!workflow) {
      setError("Could not change the workflow.");
      setModificationMessages(messages);
      return;
    }

    setGraph(workflow.graph);
    setCanvasKey((value) => value + 1);
    setDisplayName(workflow.name);
    // An edit like "run it every Monday instead" changes the schedule too.
    setSchedule(workflow.schedule);
    lastSaved.current = stableStringify(workflow.graph);
    if (versions) setLocalVersions(versions);
    setModificationMessages([]);
    setModificationQuestions([]);
    setSaveState("saved");
    setModificationFeedback(
      droppedArgs.length
        ? `Workflow changed. Ignored unsupported arguments: ${droppedArgs.join(", ")}`
        : "Workflow changed and saved as a new graph version.",
    );
    router.refresh();
  }

  /**
   * Runs the workflow and waits for the result.
   *
   * A pending autosave is flushed first, for the same reason the AI edit does
   * it: the run executes the saved graph, and running a version the user
   * cannot see on the canvas would be indefensible.
   */
  async function runNow(dryRun: boolean) {
    if (!selected || !graph || running) {
      throw new Error("Nothing to run yet.");
    }

    setRunning(dryRun ? "dry" : "live");
    setRunResult(null);
    setError(null);

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    if (!(await persistGraph(graph))) {
      setRunning(false);
      throw new Error("Could not save before running.");
    }

    // A run that outlasts the server's wait answers 202: a message, no `run`.
    const result = await requestJson<{ run?: RunSummary; error?: string }>(
      `/api/workflows/${selected.id}/run`,
      { method: "POST", body: { dryRun }, fallback: "Could not run the workflow." },
    );
    setRunning(false);

    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    if (!result.data.run) {
      const message = result.data.error ?? "Could not run the workflow.";
      setError(message);
      throw new Error(message);
    }
    setRunResult({ ...result.data.run, dryRun });
    router.refresh();
    if (result.data.run.status === "FAILED") {
      throw new Error(result.data.run.error ?? "Run failed.");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    const result = await requestJson<{ ok: true }>(`/api/workflows/${pendingDelete.id}`, {
      method: "DELETE",
      fallback: "Could not delete the workflow.",
    });
    if (!result.ok) {
      setError(result.error);
      setPendingDelete(null);
      return;
    }

    const deletedId = pendingDelete.id;
    setPendingDelete(null);
    if (selected?.id === deletedId) {
      router.push("/workflows");
    }
    router.refresh();
  }

  const islandTasks = useMemo<IslandTask[]>(() => {
    if (running !== false) {
      return [
        {
          id: "run",
          label: running === "dry" ? "Walking the graph" : "Running workflow",
          detail: displayName,
          status: "running",
        },
      ];
    }
    if (!runResult) return [];
    return [
      {
        id: runResult.runId,
        label: runResult.dryRun ? "Test run" : "Run",
        detail:
          runResult.status === "SUCCEEDED"
            ? runResult.dryRun
              ? "Nothing was sent"
              : "Finished"
            : (runResult.error ?? "Failed"),
        status: runResult.status === "SUCCEEDED" ? "done" : "error",
        action: { label: "Dismiss", onClick: () => setRunResult(null) },
      },
    ];
  }, [displayName, runResult, running]);

  return (
    <div className="flex h-full overflow-hidden bg-canvas">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar">
        <form className="border-b border-border px-4 py-4" onSubmit={createWorkflow}>
          <label className="mb-2 block text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            New workflow
          </label>
          <div className="flex gap-2">
            <input
              className={fieldClass}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Weekly report"
              aria-label="New workflow name"
            />
            <button type="submit" className={primaryButtonClass} disabled={!nameDraft.trim()}>
              Add
            </button>
          </div>
        </form>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 flex items-center justify-between px-2 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Your workflows
            <span className="font-mono text-[10px] tracking-normal text-subtle">
              {workflows.length}
            </span>
          </p>
          {workflows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              No workflows yet. Create one above or start with AI.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {workflows.map((workflow) => {
                const active = selected?.id === workflow.id;
                return (
                  <li key={workflow.id} className="group flex items-center gap-1">
                    <Link
                      href={`/workflows/${workflow.id}`}
                      className={cn(
                        "min-w-0 flex-1 rounded-lg px-3 py-2 text-sm transition",
                        active
                          ? "bg-[color-mix(in_oklch,var(--brand)_12%,transparent)] font-medium text-foreground"
                          : "text-foreground hover:bg-accent",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            active ? "bg-brand" : "bg-foreground/20",
                          )}
                        />
                        <span className="min-w-0 truncate">{workflow.name}</span>
                      </span>
                      <span className="mt-0.5 block pl-3.5 text-[11px] font-normal text-muted-foreground">
                        {relativeTime(workflow.updatedAt)}
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setPendingDelete(workflow)}
                      aria-label={`Delete ${workflow.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {selected && graph ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/75 px-5 py-3 backdrop-blur-xl">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight">
                  {displayName}
                </h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      saveState === "saving" &&
                        "animate-[pulse-live_1.2s_ease-in-out_infinite] bg-warn",
                      saveState === "error" && "bg-destructive",
                      saveState === "saved" && "bg-ok",
                    )}
                  />
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "error"
                      ? "Save failed"
                      : `Saved · version ${localVersions[0]?.revision ?? 1}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {localVersions.length > 1 ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    History
                    <select
                      className={`${fieldClass} h-9 w-auto`}
                      defaultValue=""
                      onChange={(event) => {
                        const revision = Number(event.target.value);
                        event.target.value = "";
                        if (revision) void restore(revision);
                      }}
                    >
                      <option value="" disabled>
                        Restore a version
                      </option>
                      {localVersions.map((version) => (
                        <option key={version.id} value={version.revision}>
                          v{version.revision}
                          {version.note ? ` · ${version.note}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {unconfigured.length > 0 ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-xs text-[color:var(--warn)]"
                    title={unconfigured.join(", ")}
                  >
                    {unconfigured.length} step
                    {unconfigured.length === 1 ? "" : "s"} need a tool
                  </span>
                ) : null}
                <ParticleButton
                  variant="outline"
                  size="lg"
                  className="h-9"
                  disabled={running !== false}
                  pendingLabel="Testing"
                  successLabel="Tested"
                  errorLabel="Failed"
                  particles={false}
                  onClick={() => runNow(true)}
                  title="Walk the workflow without calling any tool or sending anything"
                >
                  Test run
                </ParticleButton>
                <ParticleButton
                  size="lg"
                  className="h-9"
                  disabled={running !== false || unconfigured.length > 0}
                  pendingLabel="Running"
                  successLabel="Finished"
                  errorLabel="Failed"
                  onClick={() => runNow(false)}
                  title={
                    unconfigured.length > 0
                      ? "Every step needs a tool before this can run"
                      : undefined
                  }
                >
                  Run now
                </ParticleButton>
              </div>
            </header>

            {error ? (
              <p className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {runResult?.output || (runResult && runResult.steps.length > 0) ? (
              <div className="border-b border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                {runResult.error ? (
                  <p className="text-destructive">{runResult.error}</p>
                ) : null}
                {runResult.output ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 font-sans text-sm text-foreground">
                    {runResult.output}
                  </pre>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs">
                    {runResult.steps.length} step
                    {runResult.steps.length === 1 ? "" : "s"}
                  </summary>
                  <ol className="mt-1 flex flex-col gap-2 text-xs">
                    {runResult.steps.map((step) => (
                      <li key={step.nodeId}>
                        <span className="font-mono">{step.toolSlug ?? "model"}</span>{" "}
                        {step.status.toLowerCase()}
                        {step.error ? ` — ${step.error}` : ""}
                        {step.output ? (
                          <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1 font-mono text-[11px]">
                            {step.output}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            ) : null}

            <div className="relative min-h-0 flex-1">
              {islandTasks.length > 0 ? (
                <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
                  <div className="pointer-events-auto">
                    <StatusIsland
                      tasks={islandTasks}
                      onDismiss={() => setRunResult(null)}
                    />
                  </div>
                </div>
              ) : null}
              <ReactFlowProvider>
                <ScheduleContext.Provider value={schedule}>
                  <WorkflowCanvas
                    key={canvasKey}
                    graph={graph}
                    connections={connections}
                    onChange={queueSave}
                    schedule={schedule}
                    onSaveSchedule={saveSchedule}
                  />
                </ScheduleContext.Provider>
              </ReactFlowProvider>
              {modifying ? (
                <div
                  className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
                  aria-label="Changing workflow"
                >
                  <AITextLoading
                    texts={[
                      "Reading the graph",
                      "Rewiring the steps",
                      "Saving a new version",
                    ]}
                    label="Changing the workflow"
                  />
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-border bg-card/70 px-5 py-4 backdrop-blur-xl">
              {modificationQuestions.length > 0 ? (
                <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-border bg-muted/70 px-3 py-2">
                  <p className="mb-1 text-xs font-medium text-foreground">
                    I need one detail before changing it:
                  </p>
                  {modificationQuestions.map((question) => (
                    <p key={question.id} className="text-xs text-muted-foreground">
                      {question.question}
                      {question.suggestion ? ` (Suggested: ${question.suggestion})` : ""}
                    </p>
                  ))}
                </div>
              ) : null}

              {modificationFeedback ? (
                <p className="mx-auto mb-2 max-w-3xl text-xs text-ok">
                  {modificationFeedback}
                </p>
              ) : null}

              <form
                className="glass mx-auto flex max-w-3xl items-center gap-2 rounded-2xl p-1.5"
                onSubmit={modifyWorkflow}
              >
                <input
                  value={modification}
                  onChange={(event) => setModification(event.target.value)}
                  disabled={modifying}
                  aria-label="Describe a workflow change"
                  placeholder={
                    modificationQuestions.length > 0
                      ? "Answer here…"
                      : "Describe a change, e.g. “add a step that summarizes the emails”…"
                  }
                  className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  className={primaryButtonClass}
                  disabled={modifying || !modification.trim()}
                >
                  {modifying ? "Changing…" : "Change"}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-10 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 [background:radial-gradient(50%_40%_at_50%_40%,color-mix(in_oklch,var(--brand)_12%,transparent),transparent)]"
            />
            <div className="glass-strong relative max-w-md rounded-3xl p-8">
              <p className="text-[11px] font-medium tracking-[0.16em] text-brand uppercase">
                Studio
              </p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight">
                Select a workflow
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Create one in the sidebar, then right-click the canvas to add a
                connected tool. Drag between handles to wire steps together.
              </p>
              <Link
                href="/workflows/new"
                className={`${primaryButtonClass} mt-5 inline-flex gap-1.5`}
              >
                <Sparkles className="size-3.5" />
                Build with AI
              </Link>
            </div>
            {error ? <p className="relative text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </section>

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-workflow-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h2 id="delete-workflow-title" className="text-base font-semibold">
              Delete {pendingDelete.name}?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This removes the workflow, its version history, and any run logs.
              Hold to confirm — it cannot be undone.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <HoldButton
                variant="red"
                className="min-w-40"
                holdDuration={1100}
                onHoldComplete={() => void confirmDelete()}
              >
                Hold to delete
              </HoldButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}
