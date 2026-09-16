import { getCurrentUser, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  connectWithCredentials,
  describeComposioAccount,
  listConnectFields,
  usesRedirect,
} from "@/lib/mcp/composio";
import type { McpServerModel } from "@/generated/prisma/models";

export const dynamic = "force-dynamic";

/**
 * The credential form for toolkits that have no consent screen — an API key,
 * a bearer token, a username and password.
 *
 * Both handlers here are the non-redirect counterpart to
 * /api/mcp/connect/[serverId]/start. GET describes the form, POST submits it.
 */

async function serverFor(
  serverId: string,
  userId: string,
): Promise<McpServerModel | null> {
  return prisma.mcpServer.findFirst({
    where: {
      id: serverId,
      isEnabled: true,
      OR: [{ ownerId: null }, { ownerId: userId }],
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { serverId } = await params;
  const server = await serverFor(serverId, user.id);
  if (!server) return Response.json({ error: "Not found." }, { status: 404 });

  if (usesRedirect(server)) {
    return Response.json(
      { error: `${server.name} is connected by authorizing in a browser.` },
      { status: 400 },
    );
  }

  try {
    return Response.json({ fields: await listConnectFields(server) });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not read what this server needs.",
      },
      { status: 502 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { serverId } = await params;
  const server = await serverFor(serverId, user.id);
  if (!server) return Response.json({ error: "Not found." }, { status: 404 });

  if (usesRedirect(server)) {
    return Response.json(
      { error: `${server.name} is connected by authorizing in a browser.` },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    values?: Record<string, unknown>;
  } | null;

  const fields = await listConnectFields(server).catch(() => null);
  if (!fields) {
    return Response.json(
      { error: `Could not read what ${server.name} needs to connect.` },
      { status: 502 },
    );
  }

  // Built from the field list rather than from the request, so a caller
  // cannot smuggle extra keys into the credential payload sent upstream.
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = body?.values?.[field.name];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      if (field.required) {
        return Response.json(
          { error: `${field.displayName} is required.` },
          { status: 400 },
        );
      }
      continue;
    }

    values[field.name] = value;
  }

  let connectedAccountId: string;
  let isActive: boolean;
  try {
    ({ connectedAccountId, isActive } = await connectWithCredentials({
      server,
      userId: user.id,
      values,
    }));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : `Could not connect ${server.name}.`,
      },
      { status: 502 },
    );
  }

  // Composio can report ACTIVE before it has validated the credential, so
  // read the account back the way the OAuth callback does and believe that.
  const account = await describeComposioAccount(connectedAccountId);
  const active = account?.isActive ?? isActive;

  await prisma.userMcpConnection.upsert({
    where: { userId_serverId: { userId: user.id, serverId: server.id } },
    create: {
      userId: user.id,
      serverId: server.id,
      status: active ? "CONNECTED" : "PENDING",
      externalAccountId: connectedAccountId,
      accountLabel: account?.accountLabel ?? null,
      connectedAt: active ? new Date() : null,
    },
    update: {
      status: active ? "CONNECTED" : "PENDING",
      externalAccountId: connectedAccountId,
      accountLabel: account?.accountLabel ?? null,
      connectedAt: active ? new Date() : null,
      lastError: null,
    },
  });

  // The credential itself is not stored locally. Composio holds it, the same
  // way it holds OAuth tokens, so there is nothing here to leak — which is
  // why `UserMcpConnection.credential` stays null for these.
  return Response.json({ ok: true, status: active ? "CONNECTED" : "PENDING" });
}
