import {
  parseWebhookRequest,
  webhookCorsHeaders,
  webhookHandshakeResponse,
  WebhookTooLarge,
} from "@/lib/workflows/webhook";
import { enqueueWebhookRun, lookupWebhook } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: webhookCorsHeaders() });
}

async function ingest(request: Request, token: string) {
  if (request.method === "HEAD") {
    const found = await lookupWebhook(token);
    const status = found === "ok" ? 200 : found === "disabled" ? 409 : 404;
    return new Response(null, { status, headers: webhookCorsHeaders() });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: webhookCorsHeaders() });
  }

  let payload;
  try {
    payload = await parseWebhookRequest(request);
  } catch (error) {
    if (error instanceof WebhookTooLarge) {
      return json(413, { error: error.message });
    }
    throw error;
  }

  const result = await enqueueWebhookRun(token, payload);
  if (result.kind === "unknown") {
    return json(404, { error: "Unknown webhook." });
  }
  if (result.kind === "disabled") {
    return json(409, { error: "This webhook is turned off." });
  }

  const handshake = webhookHandshakeResponse(payload);
  if (handshake) return handshake;

  return json(200, { ok: true, runId: result.runId });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return ingest(request, token);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return ingest(request, token);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return ingest(request, token);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return ingest(request, token);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return ingest(request, token);
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return ingest(request, token);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: webhookCorsHeaders() });
}
