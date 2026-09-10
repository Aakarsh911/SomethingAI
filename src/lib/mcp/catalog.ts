import type { McpAuthType, McpTransport } from "@/generated/prisma/enums";

export type CatalogEntry = {
  slug: string;
  name: string;
  description: string;
  /** Null for Composio servers, which mint a per-user URL at call time. */
  url: string | null;
  transport: McpTransport;
  authType: McpAuthType;
  composioToolkit: string | null;
  iconUrl: string | null;
  docsUrl: string | null;
};

/**
 * The curated MCP servers every user can connect to. This is the source of
 * truth: `prisma/seed.ts` upserts these into the `McpServer` table by slug, so
 * editing an entry here and re-running `npm run db:seed` updates the row.
 *
 * User-added servers live in the same table with `ownerId` set and are not
 * listed here.
 */
export const MCP_CATALOG: CatalogEntry[] = [
  {
    slug: "gmail",
    name: "Gmail",
    description:
      "Search and read mail, manage labels, and create drafts in your Gmail account.",
    // Composio hosts the server and brokers Google's OAuth, so there is no
    // fixed URL and no Google Cloud project to set up. Google's own Gmail MCP
    // server would work too, but it is gated behind the Workspace Developer
    // Preview Program.
    url: null,
    transport: "HTTP",
    authType: "COMPOSIO",
    composioToolkit: "gmail",
    iconUrl: null,
    docsUrl: "https://composio.dev/toolkits/gmail",
  },
];

export function findCatalogEntry(slug: string): CatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.slug === slug);
}
