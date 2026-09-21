"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { McpServerView } from "@/lib/mcp/servers";
import type { WorkflowGraph } from "@/lib/workflows/graph";
import { WorkflowCanvas } from "./workflow-canvas";

export type WorkflowListItem = {
  id: string;
  name: string;
  updatedAt: string;
};

export type WorkflowVersionItem = {
  id: string;
  revision: number;
  note: string | null;
  createdAt: string;
};

export type WorkflowDetail = WorkflowListItem & {
  description: string | null;
  graph: WorkflowGraph;
};

type RunSummary = {
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  error: string | null;
  output: string | null;
  dryRun?: boolean;
  steps: {
    nodeId: string;
    status: string;
    serverSlug: string | null;
    toolSlug: string | null;
    error: string | null;
    output: string | null;
  }[];
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

const primaryButton =
  "h-9 cursor-pointer rounded-lg border border-transparent bg-black px-4 text-sm font-medium text-neutral-50 shadow-sm transition hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#ededed] dark:text-black dark:hover:bg-[#ccc]";

const secondaryButton =
  "h-9 cursor-pointer rounded-lg border border-[#e5e5e5] bg-white px-4 text-sm font-medium text-black shadow-sm transition hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#262626] dark:bg-neutral-950 dark:text-[#ededed] dark:hover:bg-[#141414]";

const ghostLink =
  "rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#666] transition hover:bg-[#f5f5f5] hover:text-black dark:text-[#999] dark:hover:bg-[#1a1a1a] dark:hover:text-[#ededed]";

export function WorkflowStudio(props: {
  workflows: WorkflowListItem[];
  selected: WorkflowDetail | null;
  versions: WorkflowVersionItem[];
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
  versions: WorkflowVersionItem[];
  connections: McpServerView[];
}) {
  const router = useRouter();
  const [nameDraft, setNameDraft] = useState("");
  const [displayName, setDisplayName] = useState(selected?.name ?? "");
  const [graph, setGraph] = useState<WorkflowGraph | null>(selected?.graph ?? null);
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
  const [runResult, setRunResult] = useState<RunSummary | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef<string>(selected ? stableStringify(selected.graph) : "");

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
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json().catch(() => null)) as {
      workflow?: { id: string };
      error?: string;
    } | null;

    if (!response.ok || !body?.workflow) {
      setError(body?.error ?? "Could not create the workflow.");
      return;
    }

    setNameDraft("");
    router.push(`/workflows/${body.workflow.id}`);
    router.refresh();
  }

  async function persistGraph(next: WorkflowGraph): Promise<boolean> {
    if (!selected) return false;
    const serialized = stableStringify(next);
    if (serialized === lastSaved.current) return true;

    setSaveState("saving");
    const response = await fetch(`/api/workflows/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: next }),
    });
    const body = (await response.json().catch(() => null)) as {
      workflow?: { graph: WorkflowGraph };
      versions?: WorkflowVersionItem[];
      error?: string;
    } | null;

    if (!response.ok || !body?.workflow) {
      setSaveState("error");
      setError(body?.error ?? "Could not save the workflow.");
      return false;
    }

    lastSaved.current = stableStringify(body.workflow.graph);
    if (body.versions) setLocalVersions(body.versions);
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

  async function restore(revision: number) {
    if (!selected) return;
    setError(null);
    const response = await fetch(
      `/api/workflows/${selected.id}/versions/${revision}/restore`,
      { method: "POST" },
    );
    const body = (await response.json().catch(() => null)) as {
      workflow?: { graph: WorkflowGraph };
      versions?: WorkflowVersionItem[];
      error?: string;
    } | null;

    if (!response.ok || !body?.workflow) {
      setError(body?.error ?? "Could not restore that version.");
      return;
    }

    setGraph(body.workflow.graph);
    setCanvasKey((value) => value + 1);
    lastSaved.current = stableStringify(body.workflow.graph);
    if (body.versions) setLocalVersions(body.versions);
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

    try {
      const response = await fetch(`/api/workflows/${selected.id}/modify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        workflow?: {
          name: string;
          graph: WorkflowGraph;
        };
        versions?: WorkflowVersionItem[];
        questions?: ModificationQuestion[];
        droppedArgs?: string[];
        error?: string;
      } | null;

      if (response.ok && body?.questions?.length) {
        const assistantMessage = body.questions
          .map((question) => `- (${question.id}) ${question.question}`)
          .join("\n");
        setModificationMessages([
          ...messages,
          { role: "assistant", content: assistantMessage },
        ]);
        setModificationQuestions(body.questions);
        return;
      }

      if (!response.ok || !body?.workflow) {
        setError(body?.error ?? "Could not change the workflow.");
        setModificationMessages(messages);
        return;
      }

      setGraph(body.workflow.graph);
      setCanvasKey((value) => value + 1);
      setDisplayName(body.workflow.name);
      lastSaved.current = stableStringify(body.workflow.graph);
      if (body.versions) setLocalVersions(body.versions);
      setModificationMessages([]);
      setModificationQuestions([]);
      setSaveState("saved");
      setModificationFeedback(
        body.droppedArgs?.length
          ? `Workflow changed. Ignored unsupported arguments: ${body.droppedArgs.join(", ")}`
          : "Workflow changed and saved as a new graph version.",
      );
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setModificationMessages(messages);
    } finally {
      setModifying(false);
    }
  }

  /**
   * Runs the workflow and waits for the result.
   *
   * A pending autosave is flushed first, for the same reason the AI edit does
   * it: the run executes the saved graph, and running a version the user
   * cannot see on the canvas would be indefensible.
   */
  async function runNow(dryRun: boolean) {
    if (!selected || !graph || running) return;

    setRunning(dryRun ? "dry" : "live");
    setRunResult(null);
    setError(null);

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      if (!(await persistGraph(graph))) return;

      const response = await fetch(`/api/workflows/${selected.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const body = (await response.json().catch(() => null)) as {
        run?: RunSummary;
        error?: string;
      } | null;

      if (!response.ok || !body?.run) {
        setError(body?.error ?? "Could not run the workflow.");
        return;
      }
      setRunResult({ ...body.run, dryRun });
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    const response = await fetch(`/api/workflows/${pendingDelete.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not delete the workflow.");
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

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#fafafa] dark:bg-[#0a0a0a]">
      <aside className="flex w-80 shrink-0 flex-col border-r border-[#ebebeb] bg-white dark:border-[#262626] dark:bg-neutral-950">
        <div className="border-b border-[#ebebeb] px-5 py-5 dark:border-[#262626]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Link
                href="/workflows"
                className="text-base font-semibold tracking-[-0.3px] text-black dark:text-[#ededed]"
              >
                Workflows
              </Link>
              <p className="mt-0.5 text-xs text-[#666] dark:text-[#999]">
                Build and run automations
              </p>
            </div>
            <UserButton />
          </div>
          <div className="mt-4 flex gap-2">
            <Link href="/workflows/new" className={ghostLink}>
              New with AI
            </Link>
            <Link href="/settings/integrations" className={ghostLink}>
              Integrations
            </Link>
          </div>
        </div>

        <form className="border-b border-[#ebebeb] px-4 py-4 dark:border-[#262626]" onSubmit={createWorkflow}>
          <label className="mb-2 block text-xs font-medium text-[#666] dark:text-[#999]">
            Create workflow
          </label>
          <div className="flex gap-2">
            <input
              className="h-9 min-w-0 flex-1 rounded-lg border border-[#ebebeb] bg-[#fafafa] px-3 text-sm outline-none focus:border-neutral-400 dark:border-[#262626] dark:bg-[#141414] dark:text-[#ededed]"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Weekly report"
              aria-label="New workflow name"
            />
            <button type="submit" className={primaryButton} disabled={!nameDraft.trim()}>
              Add
            </button>
          </div>
        </form>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-2 text-xs font-medium tracking-wide text-[#999] uppercase dark:text-[#666]">
            Your workflows
          </p>
          {workflows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#ebebeb] px-4 py-6 text-center text-sm text-[#666] dark:border-[#262626] dark:text-[#999]">
              No workflows yet. Create one above or use New with AI.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {workflows.map((workflow) => {
                const active = selected?.id === workflow.id;
                return (
                  <li key={workflow.id} className="group flex items-center gap-1.5">
                    <Link
                      href={`/workflows/${workflow.id}`}
                      className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-sm transition ${
                        active
                          ? "bg-black font-medium text-neutral-50 shadow-sm dark:bg-[#ededed] dark:text-black"
                          : "text-black hover:bg-[#f5f5f5] dark:text-[#ededed] dark:hover:bg-[#1a1a1a]"
                      }`}
                    >
                      {workflow.name}
                    </Link>
                    <button
                      type="button"
                      className="rounded-lg px-2 py-2 text-xs text-[#999] opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                      onClick={() => setPendingDelete(workflow)}
                    >
                      Delete
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
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebebeb] bg-white px-5 py-4 dark:border-[#262626] dark:bg-neutral-950">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-[-0.3px]">
                  {displayName}
                </h1>
                <p className="text-xs text-[#666] dark:text-[#999]">
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "error"
                      ? "Save failed"
                      : `Saved · version ${localVersions[0]?.revision ?? 1}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {localVersions.length > 1 ? (
                  <label className="flex items-center gap-2 text-xs text-[#666] dark:text-[#999]">
                    History
                    <select
                      className="h-9 rounded-lg border border-[#ebebeb] bg-[#fafafa] px-3 text-sm text-black dark:border-[#262626] dark:bg-[#141414] dark:text-[#ededed]"
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
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={running !== false}
                  onClick={() => void runNow(true)}
                  title="Walk the workflow without calling any tool or sending anything"
                >
                  {running === "dry" ? "Testing…" : "Test run"}
                </button>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={running !== false}
                  onClick={() => void runNow(false)}
                >
                  {running === "live" ? "Running…" : "Run now"}
                </button>
              </div>
            </header>

            {error ? (
              <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            ) : null}

            {runResult ? (
              <div
                className={`border-b px-4 py-2 text-sm ${
                  runResult.status === "SUCCEEDED"
                    ? "border-[#ebebeb] text-[#666] dark:border-[#1a1a1a] dark:text-[#999]"
                    : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                }`}
              >
                <p className="font-medium">
                  {runResult.dryRun ? "Test run" : "Run"}{" "}
                  {runResult.status === "SUCCEEDED" ? "succeeded" : "failed"}
                  {runResult.dryRun ? " — nothing was sent" : ""}
                </p>
                {runResult.error ? <p className="mt-0.5">{runResult.error}</p> : null}

                {/* The result is why the run was started, so it leads rather
                    than hiding behind a disclosure. */}
                {runResult.output ? (
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold tracking-wide text-[#999] uppercase dark:text-[#666]">
                      Result
                    </p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#f5f5f5] px-3 py-2 font-sans text-sm text-black dark:bg-[#1a1a1a] dark:text-[#ededed]">
                      {runResult.output}
                    </pre>
                  </div>
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
                          <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[#f5f5f5] px-2 py-1 font-mono text-[11px] dark:bg-[#1a1a1a]">
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
              <ReactFlowProvider>
                <WorkflowCanvas
                  key={canvasKey}
                  graph={graph}
                  connections={connections}
                  onChange={queueSave}
                />
              </ReactFlowProvider>
              {modifying ? (
                <div
                  className="absolute inset-0 z-40 cursor-wait"
                  aria-label="Changing workflow"
                />
              ) : null}
            </div>

            <div className="shrink-0 border-t border-[#ebebeb] bg-white px-5 py-4 dark:border-[#262626] dark:bg-neutral-950">
              {modificationQuestions.length > 0 ? (
                <div className="mb-3 rounded-lg bg-[#f5f5f5] px-3 py-2 dark:bg-[#1a1a1a]">
                  <p className="mb-1 text-xs font-medium text-black dark:text-[#ededed]">
                    I need one detail before changing it:
                  </p>
                  {modificationQuestions.map((question) => (
                    <p
                      key={question.id}
                      className="text-xs text-[#666] dark:text-[#999]"
                    >
                      {question.question}
                      {question.suggestion
                        ? ` (Suggested: ${question.suggestion})`
                        : ""}
                    </p>
                  ))}
                </div>
              ) : null}

              {modificationFeedback ? (
                <p className="mb-2 text-xs text-[#666] dark:text-[#999]">
                  {modificationFeedback}
                </p>
              ) : null}

              <form
                className="mx-auto flex max-w-3xl items-center gap-2"
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
                  className="h-10 min-w-0 flex-1 rounded-xl border border-[#ebebeb] bg-transparent px-3 text-sm text-black outline-none placeholder:text-[#999] focus:border-[#999] disabled:opacity-50 dark:border-[#1a1a1a] dark:text-[#ededed]"
                />
                <button
                  type="submit"
                  className={primaryButton}
                  disabled={modifying || !modification.trim()}
                >
                  {modifying ? "Changing…" : "Change"}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-10 text-center">
            <div className="max-w-md rounded-2xl border border-[#ebebeb] bg-white p-8 shadow-sm dark:border-[#262626] dark:bg-neutral-950">
              <h1 className="text-xl font-semibold tracking-[-0.4px]">
                Select a workflow
              </h1>
              <p className="mt-2 text-sm text-[#666] dark:text-[#999]">
                Create one in the sidebar, then right-click the canvas to add a
                connected tool. Drag between handles to wire steps together.
              </p>
              <Link href="/workflows/new" className={`${primaryButton} mt-5 inline-flex`}>
                Build with AI
              </Link>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        )}
      </section>

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-workflow-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-[#ebebeb] bg-white p-5 dark:border-[#1a1a1a] dark:bg-neutral-950">
            <h2 id="delete-workflow-title" className="text-base font-semibold">
              Delete {pendingDelete.name}?
            </h2>
            <p className="mt-2 text-sm text-[#666] dark:text-[#999]">
              This removes the workflow, its version history, and any run logs.
              It cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button type="button" className={primaryButton} onClick={() => void confirmDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
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
