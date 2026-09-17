import { AuthConfigTypes, Composio } from "@composio/core";
import { prisma } from "@/lib/db";
import type { McpServerModel } from "@/generated/prisma/models";

/**
 * Composio brokers the provider's OAuth flow (Google, Slack, ...) and holds
 * the resulting tokens, then exposes the tools over a hosted MCP endpoint.
 *
 * The practical consequence for this app: we never see or store a provider
 * access token. A connection is just a Composio connected account id, and the
 * MCP URL is minted per session at call time rather than persisted, because
 * it is short-lived.
 */

let cached: Composio | null = null;

export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

function client(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "COMPOSIO_API_KEY is not set. Add it to .env to connect Composio-backed servers.",
    );
  }

  cached ??= new Composio({ apiKey });
  return cached;
}

/**
 * Resolves the Composio auth config for a toolkit, creating one the first time
 * anybody connects it and caching the id on the server row.
 *
 * The id is shared across all users on purpose: an auth config is app-level
 * configuration (which OAuth app, which scopes), not per-user state.
 */
export async function ensureAuthConfig(server: McpServerModel): Promise<string> {
  if (server.composioAuthConfigId) return server.composioAuthConfigId;

  const toolkit = server.composioToolkit;
  if (!toolkit) {
    throw new Error(`${server.name} has no Composio toolkit configured.`);
  }

  // Escape hatch for bringing your own OAuth credentials: point a toolkit at
  // an auth config you built in the Composio dashboard, e.g.
  // COMPOSIO_GMAIL_AUTH_CONFIG_ID.
  const override =
    process.env[`COMPOSIO_${toolkit.toUpperCase()}_AUTH_CONFIG_ID`];
  if (override) {
    await prisma.mcpServer.update({
      where: { id: server.id },
      data: { composioAuthConfigId: override },
    });
    return override;
  }

  const composio = client();

  // Reuse an existing config for this toolkit if the dashboard already has
  // one, so we do not pile up duplicates across restarts or environments.
  const existing = await composio.authConfigs
    .list({ toolkit })
    .catch(() => null);

  const found = existing?.items?.[0]?.id;
  const authConfigId =
    found ??
    (
      await composio.authConfigs.create(toolkit, {
        type: AuthConfigTypes.COMPOSIO_MANAGED,
        name: `somethingai-${toolkit}`,
      })
    ).id;

  await prisma.mcpServer.update({
    where: { id: server.id },
    data: { composioAuthConfigId: authConfigId },
  });

  return authConfigId;
}

/**
 * Starts the hosted authorization flow and returns where to send the browser.
 *
 * `link()` is used rather than the older `initiate()` because Composio is
 * retiring `initiate()` for Composio-managed auth configs, which is what this
 * app creates by default.
 */
export async function startComposioConnect(options: {
  server: McpServerModel;
  userId: string;
  callbackUrl: string;
}): Promise<{ redirectUrl: string; requestId: string | null }> {
  const authConfigId = await ensureAuthConfig(options.server);

  const request = await client().connectedAccounts.link(
    options.userId,
    authConfigId,
    { callbackUrl: options.callbackUrl },
  );

  if (!request.redirectUrl) {
    throw new Error("Composio did not return an authorization URL.");
  }

  return { redirectUrl: request.redirectUrl, requestId: request.id ?? null };
}

/**
 * Reads back a connected account after the callback. Returns null when
 * Composio does not recognise the id, which is treated as a failed attempt.
 */
export async function describeComposioAccount(
  connectedAccountId: string,
): Promise<{ isActive: boolean; accountLabel: string | null } | null> {
  const account = await client()
    .connectedAccounts.get(connectedAccountId)
    .catch(() => null);

  if (!account) return null;

  return {
    isActive: account.status === "ACTIVE",
    accountLabel: extractAccountLabel(account),
  };
}

/**
 * Composio's connected-account payload varies by toolkit, so dig for something
 * human-readable and accept that there may be nothing worth showing.
 */
function extractAccountLabel(account: unknown): string | null {
  const seen = new Set<unknown>();
  const keys = ["email", "user_email", "userEmail", "login", "username", "name"];

  const walk = (value: unknown, depth: number): string | null => {
    if (depth > 4 || value === null || typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    for (const nested of Object.values(record)) {
      const hit = walk(nested, depth + 1);
      if (hit) return hit;
    }

    return null;
  };

  return walk(account, 0);
}

/** Best-effort revocation; the local row is removed either way. */
export async function deleteComposioAccount(
  connectedAccountId: string,
): Promise<void> {
  await client()
    .connectedAccounts.delete(connectedAccountId)
    .catch(() => undefined);
}

/**
 * Mints a live MCP endpoint for one user across the toolkits they have
 * connected. Call this at the point of use and do not persist the result —
 * the URL and headers are short-lived, and the headers carry credentials.
 */
export async function createMcpSession(options: {
  userId: string;
  toolkits: string[];
}): Promise<{ url: string; headers: Record<string, string> }> {
  const session = await client().create(options.userId, {
    toolkits: options.toolkits,
    mcp: true,
  });

  return {
    url: session.mcp.url.toString(),
    headers: session.mcp.headers as Record<string, string>,
  };
}

/**
 * Runs one tool against a user's connected account.
 *
 * `dangerouslySkipVersionCheck` is set because nothing in this app pins
 * toolkit versions yet. Without it every execution throws the moment a
 * version resolves to "latest", which is the normal case here. Pinning is the
 * right fix and belongs with the tool catalogue, not with the executor.
 */
export async function executeComposioTool(options: {
  userId: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  connectedAccountId?: string | null;
}): Promise<unknown> {
  let response;
  try {
    response = await client().tools.execute(options.toolSlug, {
      userId: options.userId,
      arguments: options.arguments,
      ...(options.connectedAccountId
        ? { connectedAccountId: options.connectedAccountId }
        : {}),
      dangerouslySkipVersionCheck: true,
    });
  } catch (error) {
    const detail = extractToolError(error);
    throw detail ? new Error(`${options.toolSlug}: ${detail}`) : error;
  }

  // Composio reports tool-level failures in the body rather than by throwing,
  // so a run would otherwise record a failed call as a successful step.
  if (!response.successful) {
    throw new Error(response.error ?? `${options.toolSlug} failed.`);
  }

  return response.data;
}

/**
 * Digs the provider's real explanation out of a Composio error.
 *
 * `ComposioToolExecutionError.message` is always "Error executing the tool X",
 * which tells the person reading a run log nothing at all. The cause it wraps
 * carries the actual reason — an oversized response, a revoked token — and
 * that is the only part worth recording.
 */
function extractToolError(error: unknown): string | null {
  const seen = new Set<unknown>();
  let message: string | null = null;
  let fix: string | null = null;

  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const record = value as Record<string, unknown>;
    // Taken from the innermost frame that has one: the outer frames repeat the
    // SDK's generic wording, the inner one is the provider speaking.
    if (typeof record.message === "string" && record.message.trim()) {
      message = record.message.trim();
    }
    if (typeof record.suggested_fix === "string" && record.suggested_fix.trim()) {
      fix = record.suggested_fix.trim();
    }

    for (const nested of Object.values(record)) walk(nested, depth + 1);
  };

  if (error instanceof Error) walk(error.cause, 0);
  if (!message) return null;
  return fix && fix !== message ? `${message} ${fix}` : message;
}
