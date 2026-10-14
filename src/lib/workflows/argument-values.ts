import type { ToolParameter } from "@/lib/ai/tool-catalog";

/** Conversion between the text in an argument box and the value a tool receives. */

/** Matches an executor template, e.g. `{{previous.output}}`. */
export const PLACEHOLDER = /\{\{\s*[^{}]+?\s*\}\}/;

/** A reference to the previous step's result. */
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
 * Turns typed text into the value the tool receives; blank means unset. Text
 * with a placeholder stays a string whatever the type, since the executor
 * fills it in at run time.
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
    if (trimmed === "true" || trimmed === "false") {
      return { ok: true, value: trimmed === "true" };
    }
    return { ok: false, error: "Expected true or false." };
  }

  if (type === "object" || type === "array") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: "Not valid JSON." };
    }
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
  }

  return { ok: true, value: text };
}

/** Long free text gets a textarea; everything else a single line. */
export function isMultiline(parameter: ToolParameter): boolean {
  if (parameter.type === "object" || parameter.type === "array") return true;
  return /body|message|content|text|html|description|prompt/i.test(parameter.name);
}
