"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DraftStep = {
  kind: "tool" | "llm";
  serverSlug: string | null;
  toolSlug: string | null;
  purpose: string;
};

type Draft = {
  name: string;
  description: string;
  graph: unknown;
  trigger: "MANUAL" | "SCHEDULE";
  cron: string | null;
  timezone: string | null;
  scheduleLabel: string | null;
  droppedArgs: string[];
  steps: DraftStep[];
};

type Turn =
  | { role: "user"; text: string }
  | { role: "draft"; draft: Draft }
  | { role: "error"; text: string };

const EXAMPLES = [
  "Every Thursday morning, fetch my unread emails and create a draft summarising them",
  "Each weekday at 6pm, label anything from my manager as Follow-up",
  "When I ask, get my latest 5 emails and summarise them",
];

export function WorkflowChat({ hasConnections }: { hasConnections: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  async function generate(text: string) {
    const trimmed = text.trim();
    if (!trimmed || generating) return;

    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setPrompt("");
    setGenerating(true);

    try {
      const response = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          // The server only trusts this after checking it against Intl; it is
          // a hint, not an authority.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      const body = (await response.json()) as { draft?: Draft; error?: string };
      setTurns((prev) => [
        ...prev,
        response.ok && body.draft
          ? { role: "draft", draft: body.draft }
          : { role: "error", text: body.error ?? "Something went wrong." },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "error", text: "Could not reach the server." },
      ]);
    } finally {
      setGenerating(false);
    }
  }

  async function save(draft: Draft) {
    setSaving(true);
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json()) as {
        workflow?: { id: string };
        error?: string;
      };

      if (response.ok && body.workflow) {
        router.push(`/workflows`);
        router.refresh();
      } else {
        setTurns((prev) => [
          ...prev,
          { role: "error", text: body.error ?? "Could not save that workflow." },
        ]);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!hasConnections && (
        <p className="rounded-xl border border-[#ebebeb] p-4 text-sm text-[#666] dark:border-[#1a1a1a] dark:text-[#999]">
          You have no connected integrations yet, so there are no tools to build
          a workflow from.{" "}
          <a
            className="font-medium text-black underline underline-offset-4 dark:text-[#ededed]"
            href="/settings/integrations"
          >
            Connect one first
          </a>
          .
        </p>
      )}

      {turns.length === 0 && hasConnections && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
            Try
          </p>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => generate(example)}
              className="rounded-xl border border-[#ebebeb] p-4 text-left text-sm text-[#666] hover:border-[#999] dark:border-[#1a1a1a] dark:text-[#999]"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {turns.map((turn, index) => {
        if (turn.role === "user") {
          return (
            <p
              key={index}
              className="self-end rounded-xl bg-[#f5f5f5] px-4 py-2 text-sm text-black dark:bg-[#1a1a1a] dark:text-[#ededed]"
            >
              {turn.text}
            </p>
          );
        }

        if (turn.role === "error") {
          return (
            <p
              key={index}
              className="rounded-xl border border-red-200 p-4 text-sm text-red-600 dark:border-red-900 dark:text-red-400"
            >
              {turn.text}
            </p>
          );
        }

        const { draft } = turn;
        return (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-xl border border-[#ebebeb] p-4 dark:border-[#1a1a1a]"
          >
            <div className="flex flex-col gap-1">
              <p className="font-medium text-black dark:text-[#ededed]">
                {draft.name}
              </p>
              <p className="text-sm text-[#666] dark:text-[#999]">
                {draft.description}
              </p>
            </div>

            <p className="text-sm text-[#666] dark:text-[#999]">
              {draft.scheduleLabel ?? "Runs only when you trigger it"}
            </p>

            <ol className="flex flex-col gap-1 text-sm text-[#666] dark:text-[#999]">
              {draft.steps.map((step, i) => (
                <li key={i}>
                  <span className="text-[#999] dark:text-[#666]">{i + 1}.</span>{" "}
                  {step.kind === "llm" ? (
                    <span className="font-mono text-xs">model</span>
                  ) : (
                    <span className="font-mono text-xs break-all">
                      {step.serverSlug}/{step.toolSlug}
                    </span>
                  )}{" "}
                  — {step.purpose}
                </li>
              ))}
            </ol>

            {draft.droppedArgs.length > 0 && (
              <p className="text-sm text-[#666] dark:text-[#999]">
                Ignored arguments the tool does not accept:{" "}
                <span className="font-mono text-xs break-all">
                  {draft.droppedArgs.join(", ")}
                </span>
              </p>
            )}

            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={saving}
                onClick={() => save(draft)}
                className="text-sm font-medium text-black underline underline-offset-4 disabled:opacity-50 dark:text-[#ededed]"
              >
                {saving ? "Saving…" : "Save workflow"}
              </button>
              <span className="text-sm text-[#999] dark:text-[#666]">
                Saved switched off — you enable it when you are ready.
              </span>
            </div>
          </div>
        );
      })}

      {generating && (
        <p className="text-sm text-[#666] dark:text-[#999]">Designing your workflow…</p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void generate(prompt);
        }}
        className="flex items-center gap-3"
      >
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={!hasConnections || generating}
          placeholder="Describe what you want to automate…"
          className="flex-1 rounded-xl border border-[#ebebeb] px-4 py-3 text-sm text-black outline-none placeholder:text-[#999] focus:border-[#999] disabled:opacity-50 dark:border-[#1a1a1a] dark:text-[#ededed]"
        />
        <button
          type="submit"
          disabled={!hasConnections || generating || !prompt.trim()}
          className="text-sm font-medium text-black underline underline-offset-4 disabled:opacity-50 dark:text-[#ededed]"
        >
          Send
        </button>
      </form>
    </div>
  );
}
