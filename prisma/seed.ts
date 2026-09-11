import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { MCP_CATALOG } from "../src/lib/mcp/catalog";

// Seeding runs from the CLI, not the Next.js server, so it builds its own
// client instead of importing src/lib/db.ts (whose hot-reload singleton is
// pointless here). Migrations use DIRECT_URL, so prefer it for consistency.
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL (or DIRECT_URL) must be set to seed.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  for (const entry of MCP_CATALOG) {
    // Upsert by slug so re-running picks up edits to src/lib/mcp/catalog.ts.
    // `ownerId` is left alone: a catalog row must never gain an owner.
    await prisma.mcpServer.upsert({
      where: { slug: entry.slug },
      create: {
        slug: entry.slug,
        name: entry.name,
        description: entry.description,
        url: entry.url,
        transport: entry.transport,
        authType: entry.authType,
        composioToolkit: entry.composioToolkit,
        iconUrl: entry.iconUrl,
        docsUrl: entry.docsUrl,
      },
      update: {
        name: entry.name,
        description: entry.description,
        url: entry.url,
        transport: entry.transport,
        authType: entry.authType,
        composioToolkit: entry.composioToolkit,
        iconUrl: entry.iconUrl,
        docsUrl: entry.docsUrl,
        isEnabled: true,
        // composioAuthConfigId is intentionally left alone: it is discovered
        // at runtime on first connect, and re-seeding must not wipe it.
      },
    });

    console.log(`Seeded MCP server: ${entry.name} (${entry.slug})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
