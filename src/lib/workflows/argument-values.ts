import type { ToolParameter } from "@/lib/ai/tool-catalog";

/**
 * Conversion between the text in an argument box and the value a tool
 * receives.
 *
 * Separate from the inspector that renders the boxes because this is the part
 * with the edge cases — placeholders in typed fields, partially typed numbers,
 * blank meaning unset — and none of it needs React to exercise.
 */

/** Matches an executor template, e.g. `{{previous.output}}`. */
export const PLACEHOLDER = /\{\{\s*[^{}]+?\s*\}\}/;

/** The reference that covers almost every real case: the last step's result. */
export const PREVIOUS_OUTPUT = "{{previous.output}}";

/** Renders a stored argument value as editable text. */
export function toDraft(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

export type Coerced =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * Turns typed text into the value the tool will receive.
 *
 * A field holding a placeholder is kept as a string whatever the declared
 * type, because the executor substitutes it at run time and cannot know the
 * result now — a `max_results` of `{{previous.output}}` is a valid template
 * and an invalid number, and rejecting it here would make every numeric
 * argument unreferenceable.
 */
export function coerce(text: string, type: ToolParameter["type"]): Coerced {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  if (PLACEHOLDER.test(trimmed)) return { ok: true, value: text };

  if (type === "number" || type === "integer") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return { ok: false, error: "Expected a number." };
    if (type === "integer" && !Number.isInteger(parsed)) {
      return { ok: false, error: "Expected a whole number." };
    }
    return { ok: true, value: parsed };
  }

  if (type === "boolean") {
    if (trimmed === "true") return { ok: true, value: true };
    if (trimmed === "false") return { ok: true, value: false };
    return { ok: false, error: "Expected true or false." };
  }

  if (type === "object" || type === "array") {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (type === "array" && !Array.isArray(parsed)) {
        return { ok: false, error: "Expected a JSON array." };
      }
      if (
        type === "object" &&
        (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      ) {
        return { ok: false, error: "Expected a JSON object." };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: "Not valid JSON." };
    }
  }

  return { ok: true, value: text };
}

/**
 * True when the committed value renders back as exactly this text.
 *
 * The inspector uses this to decide whether a box can go back to deriving its
 * text from the graph, or has to keep shadowing it: "1." commits as 1 and
 * would render back as "1", deleting the character as it is typed.
 */
export function isSettled(text: string, type: ToolParameter["type"]): boolean {
  const coerced = coerce(text, type);
  return coerced.ok && toDraft(coerced.value) === text;
}

/** Long free text gets a textarea; everything else a single line. */
export function isMultiline(parameter: ToolParameter): boolean {
  if (parameter.type === "object" || parameter.type === "array") return true;
  return /body|message|content|text|html|description|prompt/i.test(parameter.name);
}
