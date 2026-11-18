import { randomBytes } from "node:crypto";

/** Reject payloads bigger than this so a webhook cannot fill the database. */
export const MAX_WEBHOOK_BYTES = 1_000_000;

export class WebhookTooLarge extends Error {
  constructor() {
    super("Webhook payloads can be at most 1 MB.");
  }
}

export function mintWebhookSecret(): string {
  return `whk_${randomBytes(24).toString("base64url")}`;
}

export function webhookPath(secret: string): string {
  return `/api/hooks/${secret}`;
}

export type WebhookPayload = {
  method: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
};

const FORWARDED_HEADERS = new Set([
  "accept",
  "content-type",
  "user-agent",
  "x-github-event",
  "x-github-delivery",
  "x-gitlab-event",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-request-id",
  "x-slack-request-timestamp",
  "x-slack-signature",
  "stripe-signature",
  "svix-id",
  "svix-timestamp",
  "svix-signature",
]);

/** Headers callers might use to authenticate; never stored on the run. */
const REDACTED_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

export function webhookCorsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Stripe-Signature, X-Hub-Signature, X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery, X-Gitlab-Event, X-Slack-Signature, X-Slack-Request-Timestamp, Svix-Id, Svix-Timestamp, Svix-Signature",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Turns an incoming HTTP request into the object later steps read as
 * `{{previous.output}}` / `{{trigger}}`.
 */
export async function parseWebhookRequest(request: Request): Promise<WebhookPayload> {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (REDACTED_HEADERS.has(name)) return;
    if (name.startsWith("x-forwarded-")) return;
    if (FORWARDED_HEADERS.has(name) || name.startsWith("x-")) {
      headers[name] = value;
    }
  });

  return {
    method: request.method.toUpperCase(),
    query,
    headers,
    body: await readBody(request),
  };
}

async function readBody(request: Request): Promise<unknown> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return null;

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.byteLength > MAX_WEBHOOK_BYTES) throw new WebhookTooLarge();
  if (raw.byteLength === 0) return null;

  const text = raw.toString("utf8");
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }

  if (
    contentType.includes("application/json") ||
    contentType.includes("+json") ||
    looksLikeJson(text)
  ) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/** Slack url_verification and similar handshake fields. */
export function webhookHandshakeResponse(payload: WebhookPayload): Response | null {
  const challenge =
    payload.query["hub.challenge"] ??
    (isRecord(payload.body) && typeof payload.body.challenge === "string"
      ? payload.body.challenge
      : null);
  if (!challenge) return null;

  if (payload.query["hub.challenge"]) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...webhookCorsHeaders() },
    });
  }

  return Response.json(
    { ok: true, challenge },
    { headers: webhookCorsHeaders() },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
