import { getCurrentUser, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  listServersForUser,
  parseServerUrl,
  slugifyServerName,
} from "@/lib/mcp/servers";
import type { McpAuthType, McpTransport } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/** Catalog + the caller's own servers, each with its connection state. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return Response.json({ servers: await listServersForUser(user.id) });
}

// A user-added server cannot use COMPOSIO: that flow is tied to a Composio
// toolkit, which is app-level configuration rather than something a user can
// point at an arbitrary URL.
const CUSTOM_TRANSPORTS: McpTransport[] = ["HTTP", "SSE"];
const CUSTOM_AUTH_TYPES: McpAuthType[] = ["NONE", "API_KEY"];

/** Adds a server owned by the caller. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "A name is required." }, { status: 400 });
  }

  const url = parseServerUrl(body.url);
  if (!url) {
    return Response.json(
      { error: "Enter a valid https:// server URL." },
      { status: 400 },
    );
  }

  const transport = (body.transport as McpTransport) ?? "HTTP";
  if (!CUSTOM_TRANSPORTS.includes(transport)) {
    return Response.json({ error: "Unsupported transport." }, { status: 400 });
  }

  const authType = (body.authType as McpAuthType) ?? "NONE";
  if (!CUSTOM_AUTH_TYPES.includes(authType)) {
    return Response.json(
      { error: "Custom servers support no auth or an API key." },
      { status: 400 },
    );
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (authType === "API_KEY" && !apiKey) {
    return Response.json(
      { error: "An API key is required for API key auth." },
      { status: 400 },
    );
  }

  const server = await prisma.mcpServer.create({
    data: {
      slug: slugifyServerName(name),
      name,
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null,
      url: url.toString(),
      transport,
      authType,
      composioToolkit: null,
      ownerId: user.id,
      // Nothing to authorize for these, so the server is usable immediately.
      connections: {
        create: {
          userId: user.id,
          status: "CONNECTED",
          connectedAt: new Date(),
          credential: apiKey ? encrypt(apiKey) : null,
        },
      },
    },
  });

  return Response.json({ id: server.id, slug: server.slug }, { status: 201 });
}
