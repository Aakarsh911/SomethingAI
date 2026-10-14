import { AuthConfigTypes, AuthScheme, Composio } from "@composio/core";
import type { AuthSchemeType } from "@composio/core";
import { prisma } from "@/lib/db";
import { REDIRECT_SCHEMES } from "@/lib/mcp/composio-toolkits";
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
 * The scheme a server is connected with, as pinned at sync time.
 *
 * Defaults to OAUTH2 so rows written before the scheme column existed keep
 * the behaviour they had, which was Composio-managed OAuth or nothing.
 */
function schemeOf(server: McpServerModel): AuthSchemeType {
  return (server.composioAuthScheme ?? "OAUTH2") as AuthSchemeType;
}

/** True when connecting is a browser round trip rather than a form. */
export function usesRedirect(server: McpServerModel): boolean {
  return REDIRECT_SCHEMES.has(schemeOf(server));
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
  // COMPOSIO_GMAIL_AUTH_CONFIG_ID. This is the only way to connect a toolkit
  // whose OAuth application Composio does not manage.
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
  const scheme = schemeOf(server);

  // Reuse an existing config if the dashboard already has one, so we do not
  // pile up duplicates across restarts or environments. Matched on scheme as
  // well as toolkit: most toolkits offer several, and a config built for
  // OAuth2 cannot accept the API key we would go on to submit against it.
  const existing = await composio.authConfigs
    .list({ toolkit })
    .catch(() => null);

  const found = existing?.items?.find(
    (item) => (item.authScheme ?? "OAUTH2") === scheme,
  )?.id;

  const authConfigId = found ?? (await createAuthConfig(toolkit, scheme));

  await prisma.mcpServer.update({
    where: { id: server.id },
    data: { composioAuthConfigId: authConfigId },
  });

  return authConfigId;
}

/**
 * Builds the auth config, managed where Composio offers it and custom
 * otherwise.
 *
 * "Custom" here does not mean we supply credentials — for API keys, basic
 * auth and bearer tokens the config carries none, and the secret arrives
 * per-user at connect time. It only means Composio is not providing an OAuth
 * application of its own.
 */
async function createAuthConfig(
  toolkit: string,
  scheme: AuthSchemeType,
): Promise<string> {
  const composio = client();

  const isManaged = await composio.toolkits
    .get(toolkit)
    .then((details) =>
      Boolean(details.composioManagedAuthSchemes?.includes(scheme)),
    )
    .catch(() => false);

  if (isManaged) {
    const config = await composio.authConfigs.create(toolkit, {
      type: AuthConfigTypes.COMPOSIO_MANAGED,
      name: `somethingai-${toolkit}`,
    });
    return config.id;
  }

  try {
    const config = await composio.authConfigs.create(toolkit, {
      type: AuthConfigTypes.CUSTOM,
      authScheme: scheme,
      credentials: {},
      name: `somethingai-${toolkit}`,
    });
    return config.id;
  } catch (error) {
    // The common cause is an OAuth scheme Composio does not manage, which
    // needs a client id and secret this app has no way to obtain. Say so,
    // because the raw upstream error names neither the toolkit nor the fix.
    throw new Error(
      `${toolkit} needs an OAuth application that Composio does not provide. ` +
        `Create an auth config for it in the Composio dashboard and set ` +
        `COMPOSIO_${toolkit.toUpperCase()}_AUTH_CONFIG_ID. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

export type ConnectField = {
  name: string;
  displayName: string;
  description: string | null;
  required: boolean;
  /** True for values that must never be echoed back to the browser. */
  secret: boolean;
};

/**
 * The credentials the user has to supply to connect this server, straight
 * from Composio's description of the toolkit.
 *
 * Asked upstream rather than guessed from the scheme, because "API key" is
 * not one field everywhere: Perplexity wants a key, Shopify wants a key and
 * the store subdomain, Mixpanel wants a username, a password and a region.
 */
export async function listConnectFields(
  server: McpServerModel,
): Promise<ConnectField[]> {
  const toolkit = server.composioToolkit;
  if (!toolkit) return [];

  const fields = await client()
    .toolkits.getConnectedAccountInitiationFields(toolkit, schemeOf(server))
    .catch(() => []);

  return fields.map((field) => ({
    name: field.name,
    displayName: field.displayName || field.name,
    description: field.description || null,
    // Composio leaves this off for some fields; treating an unstated field as
    // optional is the safe way round, since the worst case is Composio
    // rejecting the submission rather than us blocking a valid one.
    required: field.required ?? false,
    // Composio does not flag secrecy, so infer it from the name. Erring
    // towards masking costs a user nothing; erring the other way puts an API
    // key in a plain text input and, worse, in the browser's autofill store.
    secret: /key|secret|token|password|credential/i.test(field.name),
  }));
}

/**
 * Connects a user by submitting credentials directly, for the toolkits that
 * have no consent screen to redirect to.
 *
 * Unlike the redirect flow there is no callback to verify against, so the
 * connected account is read back from Composio before it is trusted — the
 * same reason the callback route does it.
 */
export async function connectWithCredentials(options: {
  server: McpServerModel;
  userId: string;
  values: Record<string, string>;
}): Promise<{ connectedAccountId: string; isActive: boolean }> {
  const authConfigId = await ensureAuthConfig(options.server);
  const scheme = schemeOf(options.server);

  const request = await client().connectedAccounts.initiate(
    options.userId,
    authConfigId,
    { config: connectionData(scheme, options.values) },
  );

  if (!request.id) {
    throw new Error("Composio did not return a connected account.");
  }

  return {
    connectedAccountId: request.id,
    // INITIALIZING/INITIATED means Composio is still validating; the caller
    // stores the account as pending rather than claiming success.
    isActive: request.status === "ACTIVE",
  };
}

/**
 * Wraps the user's values in the envelope Composio expects for the scheme.
 *
 * The cast is unavoidable: each `AuthScheme` helper is typed against the
 * exact fields of its own scheme, while the values here are whatever
 * listConnectFields() asked for at runtime. Composio validates them against
 * the same field list on receipt, so the check happens — just not in the type
 * system.
 */
function connectionData(scheme: AuthSchemeType, values: Record<string, string>) {
  const params = values as never;

  switch (scheme) {
    case "API_KEY":
      return AuthScheme.APIKey(params);
    case "BEARER_TOKEN":
      return AuthScheme.BearerToken(params);
    case "BASIC":
      return AuthScheme.Basic(params);
    case "BASIC_WITH_JWT":
      return AuthScheme.BasicWithJWT(params);
    case "BILLCOM_AUTH":
      return AuthScheme.BillcomAuth(params);
    case "CALCOM_AUTH":
      return AuthScheme.CalcomAuth(params);
    case "GOOGLE_SERVICE_ACCOUNT":
      return AuthScheme.GoogleServiceAccount(params);
    case "NO_AUTH":
      return AuthScheme.NoAuth(params);
    default:
      throw new Error(`${scheme} cannot be connected by submitting a form.`);
  }
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
