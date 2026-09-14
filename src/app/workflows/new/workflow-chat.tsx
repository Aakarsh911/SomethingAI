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

type Question = {
  id: string;
  question: string;
  why: string;
  suggestion: string | null;
};

type Turn =
  | { role: "user"; text: string }
  | { role: "draft"; draft: Draft }
  | { role: "questions"; questions: Question[]; answered: boolean }
  | { role: "error"; text: string };

/**
 * The conversation the model sees, kept alongside the rendered turns.
 *
 * Questions are replayed as assistant turns so the model can see what it
 * asked; without them the answers arrive as context-free fragments and it
 * asks again.
 */
type Message = { role: "user" | "assistant"; content: string };

function questionsAsMessage(questions: Question[]): string {
  return questions.map((q) => `- (${q.id}) ${q.question}`).join("\n");
}

function answersAsMessage(questions: Question[], answers: Record<string, string>): string {
  return questions
    .map((q) => `- (${q.id}) ${answers[q.id]?.trim() || "no preference, decide for me"}`)
    .join("\n");
}

const EXAMPLES = [
  "Every Thursday morning, fetch my unread emails and create a draft summarising them",
  "Each weekday at 6pm, label anything from my manager as Follow-up",
  "When I ask, get my latest 5 emails and summarise them",
];

export function WorkflowChat({ hasConnections }: { hasConnections: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Sends the whole conversation, not just the latest turn.
   *
   * `next` is passed in rather than read from state because the caller has
   * just appended to it, and the state update has not committed yet.
   */
  async function send(next: Message[], display: Turn[]) {
    if (generating) return;

    setTurns((prev) => [...prev, ...display]);
    setMessages(next);
    setGenerating(true);

    try {
      const response = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          // The server only trusts this after checking it against Intl; it is
          // a hint, not an authority.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      const body = (await response.json()) as {
        draft?: Draft;
        questions?: Question[];
        error?: string;
      };

      if (response.ok && body.questions?.length) {
        setMessages([
          ...next,
          { role: "assistant", content: questionsAsMessage(body.questions) },
        ]);
        setTurns((prev) => [
          ...prev,
          { role: "questions", questions: body.questions!, answered: false },
        ]);
        return;
      }

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

  function generate(text: string) {
    const trimmed = text.trim();
    if (!trimmed || generating) return;
    setPrompt("");
    void send([...messages, { role: "user", content: trimmed }], [
      { role: "user", text: trimmed },
    ]);
  }

  /** Answers the question block at `index`, locking it so it cannot be resent. */
  function answer(index: number, questions: Question[], answers: Record<string, string>) {
    setTurns((prev) =>
      prev.map((turn, i) =>
        i === index && turn.role === "questions" ? { ...turn, answered: true } : turn,
      ),
    );
    const content = answersAsMessage(questions, answers);
    void send([...messages, { role: "user", content }], [{ role: "user", text: content }]);
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
              disabled={generating}
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

        if (turn.role === "questions") {
          return (
            <QuestionForm
              key={index}
              questions={turn.questions}
              disabled={turn.answered || generating}
              onSubmit={(answers) => answer(index, turn.questions, answers)}
            />
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
          generate(prompt);
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

/**
 * Collects answers to one batch of questions.
 *
 * Every field is optional: a user who does not care should not be trapped by
 * a question the model decided to ask, so a blank answer is sent as "decide
 * for me" rather than blocking the draft.
 */
function QuestionForm({
  questions,
  disabled,
  onSubmit,
}: {
  questions: Question[];
  disabled: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, q.suggestion ?? ""])),
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSubmit(answers);
      }}
      className="flex flex-col gap-4 rounded-xl border border-[#ebebeb] p-4 dark:border-[#1a1a1a]"
    >
      <p className="text-sm text-[#666] dark:text-[#999]">
        A couple of things I should not guess:
      </p>

      {questions.map((question) => (
        <label key={question.id} className="flex flex-col gap-1">
          <span className="text-sm font-medium text-black dark:text-[#ededed]">
            {question.question}
          </span>
          <span className="text-xs text-[#999] dark:text-[#666]">{question.why}</span>
          <input
            value={answers[question.id] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
            }
            placeholder={question.suggestion ?? "Leave blank to let me decide"}
            className="mt-1 rounded-lg border border-[#ebebeb] px-3 py-2 text-sm text-black outline-none placeholder:text-[#999] focus:border-[#999] disabled:opacity-50 dark:border-[#1a1a1a] dark:text-[#ededed]"
          />
        </label>
      ))}

      <button
        type="submit"
        disabled={disabled}
        className="self-start text-sm font-medium text-black underline underline-offset-4 disabled:opacity-50 dark:text-[#ededed]"
      >
        {disabled ? "Answered" : "Continue"}
      </button>
    </form>
  );
}
