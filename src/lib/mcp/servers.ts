import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  REDIRECT_SCHEMES,
  needsOperatorSetup,
} from "@/lib/mcp/composio-toolkits";
import type {
  McpAuthType,
  McpConnectionStatus,
  McpTransport,
} from "@/generated/prisma/enums";
import type { McpServerModel } from "@/generated/prisma/models";

export type McpConnectionView = {
  id: string;
  status: McpConnectionStatus;
  accountLabel: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
};

/**
 * How the user completes a connection, which is what the UI needs in order
 * to render the right control.
 *
 *   REDIRECT     — send the browser to a consent screen.
 *   CREDENTIALS  — ask for an API key, token or username/password inline.
 *   UNAVAILABLE  — the scheme needs an OAuth application this app does not
 *                  have; see needsOperatorSetup in composio-toolkits.ts.
 */
export type ConnectStyle = "REDIRECT" | "CREDENTIALS" | "UNAVAILABLE";

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
  composioAuthScheme: string | null;
  categories: string[];
  connectStyle: ConnectStyle;
  /** True when this row belongs to the user rather than the shared catalog. */
  isCustom: boolean;
  connection: McpConnectionView | null;
};

export type ListServersOptions = {
  /** Restrict to servers the user already has a connection row for. */
  connectedOnly?: boolean;
  /** Case-insensitive substring match on name and slug. */
  query?: string;
  /** Composio category slug, e.g. "crm". */
  category?: string;
  /**
   * Caps how many rows come back. Required for catalog browsing: the
   * Composio directory is ~1500 entries, and serialising all of them into
   * a page's props on every render is both slow and pointless when the user
   * can see a screenful.
   */
  limit?: number;
};

const CONNECTION_FIELDS = {
  id: true,
  status: true,
  accountLabel: true,
  connectedAt: true,
  lastUsedAt: true,
  lastError: true,
} as const;

/**
 * Servers the user can see — the enabled catalog plus their own — each with
 * their connection state attached.
 *
 * The credential and Composio account columns are deliberately absent from
 * the return type; this is the only shape the API and UI ever get, so they
 * cannot leak by someone forgetting to strip them at a call site.
 */
export async function listServersForUser(
  userId: string,
  options: ListServersOptions = {},
): Promise<McpServerView[]> {
  const query = options.query?.trim();

  const servers = await prisma.mcpServer.findMany({
    where: {
      isEnabled: true,
      OR: [{ ownerId: null }, { ownerId: userId }],
      ...(options.connectedOnly ? { connections: { some: { userId } } } : {}),
      ...(options.category ? { categories: { has: options.category } } : {}),
      ...(query
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: query, mode: "insensitive" as const } },
                  { slug: { contains: query, mode: "insensitive" as const } },
                ],
              },
            ],
          }
        : {}),
    },
    include: { connections: { where: { userId }, select: CONNECTION_FIELDS } },
    // A user's own servers first, then the catalog most-used first. `name` is
    // the tiebreaker so paging is deterministic where popularity ties.
    orderBy: [{ ownerId: "desc" }, { popularity: "desc" }, { name: "asc" }],
    ...(options.limit ? { take: options.limit } : {}),
  });

  return servers.map(toView);
}

/** How many catalog rows match a search, for "showing 20 of 340". */
export async function countServersForUser(
  userId: string,
  options: Pick<ListServersOptions, "query" | "category"> = {},
): Promise<number> {
  const query = options.query?.trim();

  return prisma.mcpServer.count({
    where: {
      isEnabled: true,
      OR: [{ ownerId: null }, { ownerId: userId }],
      ...(options.category ? { categories: { has: options.category } } : {}),
      ...(query
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: query, mode: "insensitive" as const } },
                  { slug: { contains: query, mode: "insensitive" as const } },
                ],
              },
            ],
          }
        : {}),
    },
  });
}

/**
 * A server row as the queries above select it: the full server plus the
 * caller's connection narrowed to CONNECTION_FIELDS. Spelled out rather than
 * inferred from the client, so the omission of `credential` and
 * `externalAccountId` is visible here and not just in the select.
 */
type ServerRow = McpServerModel & {
  connections: {
    id: string;
    status: McpConnectionStatus;
    accountLabel: string | null;
    connectedAt: Date | null;
    lastUsedAt: Date | null;
    lastError: string | null;
  }[];
};

function toView(server: ServerRow): McpServerView {
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
    composioAuthScheme: server.composioAuthScheme,
    categories: server.categories,
    connectStyle: connectStyleFor(server),
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
}

/**
 * Decides which connect control a server gets.
 *
 * `composioAuthConfigId` being set is what rescues the operator-setup cases:
 * once somebody has pointed the toolkit at an auth config through
 * COMPOSIO_<TOOLKIT>_AUTH_CONFIG_ID, the OAuth application exists and the
 * flow works like any other. That is why it is checked before the scheme.
 */
function connectStyleFor(server: ServerRow): ConnectStyle {
  if (server.authType !== "COMPOSIO") {
    return server.authType === "API_KEY" ? "CREDENTIALS" : "UNAVAILABLE";
  }

  const scheme = server.composioAuthScheme ?? "OAUTH2";
  const usable =
    Boolean(server.composioAuthConfigId) ||
    !needsOperatorSetup(
      scheme,
      server.composioManagedAuth ? [scheme] : [],
    );

  if (!usable) return "UNAVAILABLE";
  return REDIRECT_SCHEMES.has(scheme) ? "REDIRECT" : "CREDENTIALS";
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
