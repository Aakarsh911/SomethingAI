import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import {
  createMcpSession,
  deleteComposioAccount,
  describeComposioAccount,
} from "@/lib/mcp/composio";

export class McpConnectionError extends Error {}

/**
 * A live MCP endpoint for everything the user has connected through Composio.
 *
 * One session spans every connected toolkit, which is how Composio's tool
 * router is meant to be used — a session per server would multiply endpoints
 * for no benefit. Call this at the point of use: the URL is short-lived and
 * the headers carry credentials, so neither should be cached or sent to a
 * browser.
 */
export async function getMcpSessionForUser(
  userId: string,
): Promise<{ url: string; headers: Record<string, string> } | null> {
  const connections = await prisma.userMcpConnection.findMany({
    where: {
      userId,
      status: "CONNECTED",
      server: { authType: "COMPOSIO", isEnabled: true },
    },
    include: { server: true },
  });

  const toolkits = connections
    .map((connection) => connection.server.composioToolkit)
    .filter((toolkit): toolkit is string => Boolean(toolkit));

  if (toolkits.length === 0) return null;

  const session = await createMcpSession({ userId, toolkits });

  await prisma.userMcpConnection.updateMany({
    where: { id: { in: connections.map((connection) => connection.id) } },
    data: { lastUsedAt: new Date() },
  });

  return session;
}

/** The decrypted API key for an API_KEY server, for calling it directly. */
export async function getApiKeyForConnection(
  connectionId: string,
): Promise<string> {
  const connection = await prisma.userMcpConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection?.credential) {
    throw new McpConnectionError("Connection has no stored API key.");
  }

  return decrypt(connection.credential);
}

/**
 * Re-reads a Composio connection's real state and mirrors it locally.
 *
 * Worth doing before relying on a connection, because it can go stale without
 * anything happening in this app: the user can revoke access from their Google
 * account, or Composio can give up refreshing an expired token.
 */
export async function refreshConnectionStatus(
  connectionId: string,
): Promise<void> {
  const connection = await prisma.userMcpConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection?.externalAccountId) return;

  const account = await describeComposioAccount(connection.externalAccountId);

  if (!account) {
    await prisma.userMcpConnection.update({
      where: { id: connection.id },
      data: {
        status: "REVOKED",
        lastError: "Composio no longer recognises this connection.",
      },
    });
    return;
  }

  await prisma.userMcpConnection.update({
    where: { id: connection.id },
    data: account.isActive
      ? {
          status: "CONNECTED",
          lastError: null,
          accountLabel: account.accountLabel ?? connection.accountLabel,
        }
      : {
          status: "ERROR",
          lastError: "This connection is no longer active. Reconnect it.",
        },
  });
}

export async function markConnectionError(
  connectionId: string,
  message: string,
): Promise<void> {
  await prisma.userMcpConnection.update({
    where: { id: connectionId },
    data: { status: "ERROR", lastError: message },
  });
}

/**
 * Drops a connection and deletes the Composio connected account behind it.
 * Deletion upstream is best-effort: the local row must disappear even if
 * Composio is unreachable, otherwise a user could never disconnect.
 */
export async function disconnect(
  userId: string,
  serverId: string,
): Promise<boolean> {
  const connection = await prisma.userMcpConnection.findUnique({
    where: { userId_serverId: { userId, serverId } },
  });

  if (!connection) return false;

  if (connection.externalAccountId) {
    await deleteComposioAccount(connection.externalAccountId);
  }

  await prisma.userMcpConnection.delete({ where: { id: connection.id } });
  return true;
}
