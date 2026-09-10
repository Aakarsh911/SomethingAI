import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type {
  McpAuthType,
  McpConnectionStatus,
  McpTransport,
} from "@/generated/prisma/enums";

export type McpConnectionView = {
  id: string;
  status: McpConnectionStatus;
  accountLabel: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
};

export type McpServerView = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  docsUrl: string | null;
  url: string | null;
  transport: McpTransport;
  authType: McpAuthType;
  composioToolkit: string | null;
  /** True when this row belongs to the user rather than the shared catalog. */
  isCustom: boolean;
  connection: McpConnectionView | null;
};

/**
 * Every server the user can see — the enabled catalog plus their own — each
 * with their connection state attached.
 *
 * The credential and Composio account columns are deliberately absent from
 * the return type; this is the only shape the API and UI ever get, so they
 * cannot leak by someone forgetting to strip them at a call site.
 */
export async function listServersForUser(
  userId: string,
): Promise<McpServerView[]> {
  const servers = await prisma.mcpServer.findMany({
    where: {
      isEnabled: true,
      OR: [{ ownerId: null }, { ownerId: userId }],
    },
    include: {
      connections: {
        where: { userId },
        select: {
          id: true,
          status: true,
          accountLabel: true,
          connectedAt: true,
          lastUsedAt: true,
          lastError: true,
        },
      },
    },
    orderBy: [{ ownerId: "asc" }, { name: "asc" }],
  });

  return servers.map((server) => {
    const connection = server.connections[0] ?? null;

    return {
      id: server.id,
      slug: server.slug,
      name: server.name,
      description: server.description,
      iconUrl: server.iconUrl,
      docsUrl: server.docsUrl,
      url: server.url,
      transport: server.transport,
      authType: server.authType,
      composioToolkit: server.composioToolkit,
      isCustom: server.ownerId !== null,
      connection: connection && {
        id: connection.id,
        status: connection.status,
        accountLabel: connection.accountLabel,
        connectedAt: connection.connectedAt?.toISOString() ?? null,
        lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
        lastError: connection.lastError,
      },
    };
  });
}

/**
 * Builds a URL-safe slug with a random suffix. Slugs are globally unique (see
 * the note on `McpServer` in the schema), so two users naming their server
 * "My Server" must not collide.
 */
export function slugifyServerName(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "mcp-server";

  return `${base}-${randomBytes(4).toString("hex")}`;
}

/** Rejects anything that is not an https endpoint we are willing to call. */
export function parseServerUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim() === "") return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  // Plain http is allowed only for localhost, so a custom server can be
  // developed locally without weakening the rule for real deployments.
  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    return null;
  }

  return url;
}
