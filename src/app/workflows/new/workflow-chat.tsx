"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { FaMicrophone, FaStop } from "react-icons/fa";
import { AgentTrace } from "@/components/agent-trace";
import AI_Prompt from "@/components/kokonutui/ai-prompt";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { GeneratedTrigger } from "@/lib/workflows/schedule";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

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
  trigger: GeneratedTrigger;
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
  const [turns, setTurns] = useState<Turn[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [traceRun, setTraceRun] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const [shouldResetTranscript, setShouldResetTranscript] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Sends the whole conversation, not just the latest turn.
   *
   * `next` is passed in rather than read from state because the caller has
   * just appended to it, and the state update has not committed yet.
   */
  async function send(next: Message[], display: Turn[], signal?: AbortSignal) {
    if (generating) return;

    setTurns((prev) => [...prev, ...display]);
    setMessages(next);
    setGenerating(true);

    try {
      const response = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
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
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setTurns((prev) => [
        ...prev,
        { role: "error", text: "Could not reach the server." },
      ]);
    } finally {
      setGenerating(false);
    }
  }

  function generate(text: string, signal?: AbortSignal) {
    const trimmed = text.trim();
    if (!trimmed || generating) return;
    setTraceRun((current) => current + 1);
    setShouldResetTranscript(true);
    SpeechRecognition.stopListening();
    return send(
      [...messages, { role: "user", content: trimmed }],
      [{ role: "user", text: trimmed }],
      signal,
    );
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
        return;
      }
      const message = body.error ?? "Could not save that workflow.";
      setTurns((prev) => [...prev, { role: "error", text: message }]);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  }

  const empty = turns.length === 0 && !generating;

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || empty) return;
    thread.scrollTo({ top: thread.scrollHeight });
  }, [turns, generating, empty]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-6 min-[600px]:px-10">
      <div
        ref={threadRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
<<<<<<< HEAD
        {empty ? (
          <div className="flex flex-col items-center text-center">
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
              Describe the busywork.
            </h1>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-foreground/80">
              You will see the steps before anything is saved. Nothing runs until
              you switch it on.
            </p>
          </div>
        ) : null}

        {!hasConnections && (
          <p className="mx-auto mt-8 max-w-lg text-center text-sm text-foreground/80">
            You have no connected integrations yet, so there are no tools to build
            a workflow from.{" "}
            <a
              className="font-medium text-foreground underline underline-offset-4"
              href="/settings/integrations"
            >
              Connect one first
            </a>
            .
          </p>
        )}

        {empty && hasConnections ? (
          <div className="mx-auto mt-8 flex w-full max-w-lg flex-col gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => generate(example)}
                disabled={generating}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm leading-relaxed text-foreground shadow-sm transition hover:border-g-blue/50 hover:bg-g-blue/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">{example}</span>
                <ArrowUpRight className="size-4 shrink-0 text-g-blue" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-8">
          {turns.map((turn, index) => {
            if (turn.role === "user") {
              return (
                <p
                  key={index}
                  className="ml-auto max-w-[88%] text-right text-[15px] leading-relaxed text-foreground"
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
                <p key={index} className="text-sm text-destructive">
                  {turn.text}
                </p>
              );
            }

            const { draft } = turn;
            return (
              <div key={index} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <p className="text-base font-semibold tracking-tight text-foreground">
                    {draft.name}
                  </p>
                  <p className="text-sm text-foreground/80">
                    {draft.description}
                  </p>
                </div>

                <p className="text-xs text-foreground/75">
                  <span className="mr-1.5 inline-block size-1.5 translate-y-[-1px] rounded-full bg-g-green" />
                  {draft.scheduleLabel ?? "Runs only when you trigger it"}
                </p>

                <ol className="flex flex-col gap-3 border-l border-foreground/10 pl-4">
                  {draft.steps.map((step, i) => (
                    <li key={i} className="relative text-sm text-muted-foreground">
                      <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-g-blue" />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {step.kind === "llm"
                          ? "model"
                          : `${step.serverSlug}/${step.toolSlug}`}
                      </span>
                      <p className="mt-0.5 text-foreground/85">{step.purpose}</p>
                    </li>
                  ))}
                </ol>

                {draft.droppedArgs.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Ignored arguments the tool does not accept:{" "}
                    <span className="font-mono text-xs break-all">
                      {draft.droppedArgs.join(", ")}
                    </span>
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <ParticleButton
                    disabled={saving}
                    pendingLabel="Saving"
                    successLabel="Saved"
                    onClick={() => save(draft)}
                  >
                    Save workflow
                  </ParticleButton>
                  <span className="text-xs text-foreground/70">
                    Saved switched off — you enable it when you are ready.
                  </span>
                </div>
              </div>
            );
          })}

          {traceRun > 0 ? (
            <AgentTrace key={traceRun} active={generating} preset="generate" />
          ) : null}
        </div>
      </div>

      <div className="relative mx-auto mb-4 w-full max-w-2xl shrink-0">
        <AI_Prompt
          className="py-2"
          commands={[]}
          defaultModel="SomethingAI"
          disabled={!hasConnections}
          headerText=""
          models={[{ name: "SomethingAI" }]}
          placeholder="Describe what you want to automate…"
          showAttach={false}
          onSubmit={(value, _model, options) => {
            setShouldResetTranscript(true);
            return generate(value, options.signal);
          }}
        />
        <div className="absolute right-16 bottom-[22px] z-10 pointer-events-auto">
          <Dictaphone promptInputRef={promptInputRef} shouldReset={shouldResetTranscript} />
        </div>
      </div>
    </div>
  );
}

const Dictaphone = ({ promptInputRef, shouldReset }: { promptInputRef: React.RefObject<HTMLTextAreaElement>; shouldReset?: boolean }) => {
  const [isMounted, setIsMounted] = useState(false);
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition
  } = useSpeechRecognition();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (shouldReset) {
      resetTranscript();
    }
  }, [shouldReset, resetTranscript]);

  useEffect(() => {
    if (transcript) {
      // Find the textarea in the AI_Prompt component
      const textarea = document.querySelector('textarea[placeholder*="automate"]') as HTMLTextAreaElement;
      if (textarea) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(textarea, transcript);
          const event = new Event('input', { bubbles: true });
          textarea.dispatchEvent(event);
        }
      }
    }
  }, [transcript]);

  if (!isMounted || !browserSupportsSpeechRecognition) {
    return null;
  }

  return !listening ? (
    <button
      type="button"
      onClick={() => {
        SpeechRecognition.startListening({ continuous: true, language: 'en-US' });
      }}
      className="flex size-8 items-center justify-center rounded-full text-black/60 hover:bg-black/5 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white transition-[background-color,color] duration-150"
      aria-label="Start voice input"
    >
      <FaMicrophone className="size-4" />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => {
        SpeechRecognition.stopListening();
        resetTranscript();
      }}
      className="flex size-8 items-center justify-center rounded-full text-red-500 dark:text-red-400 animate-pulse"
      aria-label="Stop voice input"
    >
      <FaStop className="size-4" />
    </button>
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
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-muted-foreground">
        A couple of things I should not guess:
      </p>

      {questions.map((question) => (
        <label key={question.id} className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">
            {question.question}
          </span>
          <span className="text-xs text-subtle">{question.why}</span>
          <input
            value={answers[question.id] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
            }
            placeholder={question.suggestion ?? "Leave blank to let me decide"}
            className="mt-1 w-full border-0 border-b border-foreground/15 bg-transparent px-0 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground disabled:opacity-50"
          />
        </label>
      ))}

      <button
        type="submit"
        disabled={disabled}
        className="inline-flex h-9 self-start items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/85 disabled:opacity-50"
      >
        {disabled ? "Answered" : "Continue"}
      </button>
    </form>
  );
}
