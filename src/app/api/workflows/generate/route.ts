import { getCurrentUser, unauthorized } from "@/lib/auth";
import {
  availableToolsForUser,
  connectedAccountsForUser,
} from "@/lib/ai/tool-catalog";
import {
  GenerationError,
  generateWorkflowDraft,
  type BuilderMessage,
} from "@/lib/ai/generate-workflow";
import { isValidTimezone } from "@/lib/workflows/schedule";

export const dynamic = "force-dynamic";

/**
 * Turns a prompt into a workflow draft. Writes nothing — the client shows the
 * draft and the user confirms it via POST /api/workflows.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // The builder is multi-turn: the model may answer with questions, and it
  // needs its own question back in context to make sense of the reply. The
  // conversation lives in the client and is replayed on each call rather than
  // being stored, so there is no session to expire mid-draft.
  const messages = readMessages(body);
  if (!messages) {
    return Response.json(
      { error: "Describe what you want to automate." },
      { status: 400 },
    );
  }
  if (messages.length > 20) {
    return Response.json(
      { error: "This conversation is too long. Start a new one." },
      { status: 400 },
    );
  }
  if (messages.some((message) => message.content.length > 2000)) {
    return Response.json({ error: "That message is too long." }, { status: 400 });
  }

  // The browser reports the zone; anything unrecognised falls back to UTC
  // rather than being trusted into a cron expression.
  const claimed = typeof body.timezone === "string" ? body.timezone : "";
  const timezone = isValidTimezone(claimed) ? claimed : "UTC";

  const [tools, accounts] = await Promise.all([
    availableToolsForUser(user.id),
    connectedAccountsForUser(user.id),
  ]);

  try {
    const result = await generateWorkflowDraft({
      messages,
      tools,
      timezone,
      identity: { email: user.email, accounts },
    });
    return result.kind === "questions"
      ? Response.json({ questions: result.questions })
      : Response.json({ draft: result.draft });
  } catch (error) {
    // A GenerationError is a message for the user — a missing integration, an
    // unbuildable request — so it is a 422 with the explanation intact.
    // Anything else is ours and should not be echoed back.
    if (error instanceof GenerationError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("workflow generation failed", error);
    return Response.json(
      { error: "Could not generate a workflow just now. Try again." },
      { status: 502 },
    );
  }
}

/**
 * Reads the conversation off the body, accepting a bare `prompt` as a
 * one-message conversation so a single-shot caller still works.
 *
 * Returns null when there is nothing usable, rather than an empty array, so
 * the caller does not have to distinguish "absent" from "all blank".
 */
function readMessages(body: Record<string, unknown>): BuilderMessage[] | null {
  const raw = body.messages;

  if (Array.isArray(raw)) {
    const messages = raw
      .filter(
        (entry): entry is { role: unknown; content: unknown } =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => ({
        // Anything that is not explicitly the assistant is treated as the
        // user, so a malformed role cannot smuggle in a system turn.
        role: entry.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: typeof entry.content === "string" ? entry.content.trim() : "",
      }))
      .filter((message) => message.content.length > 0);

    return messages.length > 0 ? messages : null;
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  return prompt ? [{ role: "user", content: prompt }] : null;
}
