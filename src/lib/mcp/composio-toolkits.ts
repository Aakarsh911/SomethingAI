/**
 * Reads Composio's toolkit directory — the ~1500 integrations it brokers —
 * and reduces each one to the handful of facts the catalog needs.
 *
 * This is the input to `npm run db:sync-composio`, which writes the results
 * into `McpServer`. It talks to the REST API rather than going through
 * @composio/core because the SDK's `toolkits.get()` discards `next_cursor`
 * when it reshapes the response, so paging past the first 100 toolkits is not
 * possible through it.
 */

const COMPOSIO_API = "https://backend.composio.dev/api/v3";

/** Composio caps `limit` well below the total, so every read is paged. */
const PAGE_SIZE = 100;

/**
 * Stops a broken cursor from looping forever. Sized with room to spare: the
 * directory is ~16 pages today, and the sync reports when it hits the ceiling
 * rather than silently importing a prefix.
 */
const MAX_PAGES = 200;

/**
 * Schemes whose connection is completed by sending the user to the provider
 * and waiting for a callback, as opposed to collecting a credential inline.
 *
 * S2S_OAUTH2 is absent on purpose: it is a machine-to-machine grant with no
 * consent screen for a user to land on.
 */
export const REDIRECT_SCHEMES = new Set(["OAUTH2", "OAUTH1", "DCR_OAUTH"]);

/**
 * Schemes this app can set up end-to-end without an operator first
 * registering an OAuth application with the provider.
 *
 * Everything here needs either nothing at all or values the user can paste in
 * themselves. Plain OAUTH2 is the notable omission: unless Composio manages
 * it, creating the auth config demands a client id and secret that only the
 * person running this app can obtain. Those toolkits are still imported, but
 * they stay unconnectable until someone supplies an auth config id through
 * the COMPOSIO_<TOOLKIT>_AUTH_CONFIG_ID escape hatch in composio.ts.
 */
const SELF_SERVE_SCHEMES = [
  "NO_AUTH",
  "API_KEY",
  "BEARER_TOKEN",
  "BASIC",
  "BASIC_WITH_JWT",
  "BILLCOM_AUTH",
  "CALCOM_AUTH",
  "DCR_OAUTH",
];

export type ComposioToolkit = {
  /** 0-based position in Composio's usage ordering; 0 is the most used. */
  rank: number;
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  appUrl: string | null;
  categories: string[];
  toolsCount: number;
  authSchemes: string[];
  composioManagedAuthSchemes: string[];
  noAuth: boolean;
};

type RawToolkit = {
  slug?: string;
  name?: string;
  auth_schemes?: string[];
  composio_managed_auth_schemes?: string[];
  no_auth?: boolean;
  meta?: {
    description?: string;
    logo?: string;
    app_url?: string;
    tools_count?: number;
    categories?: { id?: string; name?: string }[];
  };
};

type RawPage = {
  items?: RawToolkit[];
  next_cursor?: string | null;
  total_items?: number;
};

/**
 * Picks the one scheme this app will connect a toolkit with.
 *
 * A toolkit can advertise several — Shopify offers API_KEY, OAUTH2 and
 * S2S_OAUTH2 — and they are not equally usable here. The order below is by
 * how much setup each costs the person trying to connect:
 *
 *   1. A Composio-managed scheme. Composio owns the OAuth application, so the
 *      user clicks through a consent screen and nothing has to be configured.
 *   2. No auth at all.
 *   3. A credential the user already has and can paste.
 *   4. Anything else, which will need an operator-supplied auth config.
 *
 * Returns null only for a toolkit that advertises no schemes at all.
 */
export function pickAuthScheme(toolkit: {
  authSchemes: string[];
  composioManagedAuthSchemes: string[];
  noAuth: boolean;
}): string | null {
  const managed = toolkit.composioManagedAuthSchemes[0];
  if (managed) return managed;

  if (toolkit.noAuth || toolkit.authSchemes.includes("NO_AUTH")) {
    return "NO_AUTH";
  }

  for (const scheme of SELF_SERVE_SCHEMES) {
    if (toolkit.authSchemes.includes(scheme)) return scheme;
  }

  return toolkit.authSchemes[0] ?? null;
}

/**
 * True when connecting needs credentials this app cannot obtain on the user's
 * behalf, i.e. an OAuth client registration. Such toolkits are imported so
 * they are discoverable, but the UI has to say why the button does nothing
 * instead of starting a flow that fails at the redirect.
 */
export function needsOperatorSetup(
  scheme: string | null,
  composioManagedAuthSchemes: string[],
): boolean {
  if (!scheme) return true;
  if (composioManagedAuthSchemes.includes(scheme)) return false;
  return !SELF_SERVE_SCHEMES.includes(scheme);
}

function normalise(raw: RawToolkit, rank: number): ComposioToolkit | null {
  if (!raw.slug || !raw.name) return null;

  return {
    rank,
    slug: raw.slug,
    name: raw.name,
    description: raw.meta?.description?.trim() || null,
    logo: raw.meta?.logo ?? null,
    appUrl: raw.meta?.app_url ?? null,
    categories: (raw.meta?.categories ?? [])
      .map((category) => category.id)
      .filter((id): id is string => Boolean(id)),
    toolsCount: raw.meta?.tools_count ?? 0,
    authSchemes: raw.auth_schemes ?? [],
    composioManagedAuthSchemes: raw.composio_managed_auth_schemes ?? [],
    noAuth: raw.no_auth ?? false,
  };
}

/**
 * Every toolkit in the directory, following the cursor to the end.
 *
 * A failed page throws rather than returning what it has so far: a short read
 * looks identical to toolkits having been removed, and the sync retires rows
 * it does not see.
 */
export async function fetchAllToolkits(
  apiKey: string,
  onPage?: (loaded: number, total: number | null) => void,
): Promise<ComposioToolkit[]> {
  const toolkits: ComposioToolkit[] = [];
  let cursor: string | null = null;
  let total: number | null = null;
  let pages = 0;

  do {
    const url = new URL(`${COMPOSIO_API}/toolkits`);
    url.searchParams.set("limit", String(PAGE_SIZE));
    // Ask for the most-used first so each toolkit's position in the response
    // is a usable ranking. The order is stable across pages.
    url.searchParams.set("sort_by", "usage");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!response.ok) {
      throw new Error(
        `Composio returned ${response.status} listing toolkits: ${await response
          .text()
          .catch(() => "")}`.trim(),
      );
    }

    const page = (await response.json()) as RawPage;
    for (const raw of page.items ?? []) {
      const toolkit = normalise(raw, toolkits.length);
      if (toolkit) toolkits.push(toolkit);
    }

    total = page.total_items ?? total;
    cursor = page.next_cursor ?? null;
    pages += 1;
    onPage?.(toolkits.length, total);
  } while (cursor && pages < MAX_PAGES);

  if (cursor) {
    throw new Error(
      `Stopped after ${MAX_PAGES} pages with a cursor still pending. ` +
        "Refusing to continue, because a partial list would retire every " +
        "toolkit that was not reached.",
    );
  }

  return toolkits;
}
