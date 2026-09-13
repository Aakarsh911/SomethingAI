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

const primaryButton =
  "h-8 cursor-pointer rounded-full border border-transparent bg-black px-3 text-sm font-medium text-neutral-50 transition-all duration-200 hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#ededed] dark:text-black dark:hover:bg-[#ccc]";

const secondaryButton =
  "h-8 cursor-pointer rounded-full border border-[#ebebeb] bg-transparent px-3 text-sm font-medium text-black transition-all duration-200 hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#1a1a1a] dark:text-[#ededed] dark:hover:bg-[#1a1a1a]";

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
  const [graph, setGraph] = useState<WorkflowGraph | null>(selected?.graph ?? null);
  const [localVersions, setLocalVersions] = useState(versions);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkflowListItem | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
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

  async function persistGraph(next: WorkflowGraph) {
    if (!selected) return;
    const serialized = stableStringify(next);
    if (serialized === lastSaved.current) return;

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
      return;
    }

    lastSaved.current = stableStringify(body.workflow.graph);
    if (body.versions) setLocalVersions(body.versions);
    setSaveState("saved");
    router.refresh();
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
    <div className="flex h-[100dvh] overflow-hidden bg-white dark:bg-neutral-950">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[#ebebeb] dark:border-[#1a1a1a]">
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/workflows" className="text-sm font-semibold tracking-[-0.2px]">
            Workflows
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/settings/integrations"
              className="text-xs text-[#666] underline underline-offset-4 dark:text-[#999]"
            >
              Integrations
            </Link>
            <UserButton />
          </div>
        </div>

        <form className="flex gap-2 px-4 pb-4" onSubmit={createWorkflow}>
          <input
            className="h-8 flex-1 rounded-lg border border-[#ebebeb] bg-transparent px-2 text-sm outline-none focus:border-neutral-400 dark:border-[#1a1a1a]"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="New workflow"
            aria-label="New workflow name"
          />
          <button type="submit" className={primaryButton} disabled={!nameDraft.trim()}>
            Add
          </button>
        </form>

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {workflows.length === 0 ? (
            <p className="px-2 text-sm text-[#666] dark:text-[#999]">
              No workflows yet. Add one to open the canvas.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {workflows.map((workflow) => {
                const active = selected?.id === workflow.id;
                return (
                  <li key={workflow.id} className="group flex items-center gap-1">
                    <Link
                      href={`/workflows/${workflow.id}`}
                      className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-sm ${
                        active
                          ? "bg-black text-neutral-50 dark:bg-[#ededed] dark:text-black"
                          : "text-black hover:bg-[#f2f2f2] dark:text-[#ededed] dark:hover:bg-[#1a1a1a]"
                      }`}
                    >
                      {workflow.name}
                    </Link>
                    <button
                      type="button"
                      className={`${secondaryButton} px-2`}
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
            <header className="flex items-center justify-between gap-3 border-b border-[#ebebeb] px-4 py-3 dark:border-[#1a1a1a]">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">{selected.name}</h1>
                <p className="text-xs text-[#666] dark:text-[#999]">
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "error"
                      ? "Save failed"
                      : `Saved · v${localVersions[0]?.revision ?? 1}`}
                </p>
              </div>

              {localVersions.length > 1 ? (
                <label className="flex items-center gap-2 text-xs text-[#666] dark:text-[#999]">
                  History
                  <select
                    className="h-8 rounded-lg border border-[#ebebeb] bg-transparent px-2 text-sm text-black dark:border-[#1a1a1a] dark:text-[#ededed]"
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
            </header>

            {error ? (
              <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            ) : null}

            <div className="min-h-0 flex-1">
              <ReactFlowProvider>
                <WorkflowCanvas
                  key={canvasKey}
                  graph={graph}
                  connections={connections}
                  onChange={queueSave}
                />
              </ReactFlowProvider>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-start justify-center gap-2 px-10">
            <h1 className="text-xl font-semibold tracking-[-0.4px]">Select a workflow</h1>
            <p className="max-w-md text-sm text-[#666] dark:text-[#999]">
              Add one in the sidebar, then right-click the canvas to drop a
              connected tool onto it. Drag between handles to wire the steps.
            </p>
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
