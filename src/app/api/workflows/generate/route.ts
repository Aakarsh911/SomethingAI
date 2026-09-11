import { getCurrentUser, unauthorized } from "@/lib/auth";
import { availableToolsForUser } from "@/lib/ai/tool-catalog";
import {
  GenerationError,
  generateWorkflowDraft,
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

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "Describe what you want to automate." }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return Response.json({ error: "That prompt is too long." }, { status: 400 });
  }

  // The browser reports the zone; anything unrecognised falls back to UTC
  // rather than being trusted into a cron expression.
  const claimed = typeof body.timezone === "string" ? body.timezone : "";
  const timezone = isValidTimezone(claimed) ? claimed : "UTC";

  const tools = await availableToolsForUser(user.id);

  try {
    const draft = await generateWorkflowDraft({ prompt, tools, timezone });
    return Response.json({ draft });
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
