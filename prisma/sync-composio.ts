// Loaded explicitly: unlike prisma/seed.ts this runs straight from tsx rather
// than through `prisma db seed`, so nothing has read prisma7.config.ts (and
// with it .env) by the time this file executes.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  fetchAllToolkits,
  pickAuthScheme,
} from "../src/lib/mcp/composio-toolkits";

/**
 * Mirrors Composio's toolkit directory into the `McpServer` catalog.
 *
 * Run with `npm run db:sync-composio`. Separate from `db:seed` because the two
 * answer to different things: the seed replays a file in this repo and is part
 * of `migrate reset`, whereas this reaches out to a third party whose list
 * changes on its own schedule and should not be a prerequisite for having a
 * working database.
 *
 * Ordering matters if you run both: seed last, so the hand-written overrides
 * in src/lib/mcp/catalog.ts win over the generic text Composio supplies.
 */

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL (or DIRECT_URL) must be set to sync.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * Written in chunks rather than one transaction per row, because ~1500
 * round trips is the difference between a sync that takes a second and one
 * that takes a minute.
 */
const CHUNK_SIZE = 50;

async function main() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "COMPOSIO_API_KEY is not set. Add it to .env — the toolkit directory " +
        "is only readable with a key.",
    );
  }

  const toolkits = await fetchAllToolkits(apiKey, (loaded, total) => {
    process.stdout.write(`\rFetched ${loaded}${total ? `/${total}` : ""}…`);
  });
  process.stdout.write("\n");

  if (toolkits.length === 0) {
    throw new Error(
      "Composio returned no toolkits. Refusing to sync, because that would " +
        "retire the entire catalog.",
    );
  }

  let created = 0;
  let updated = 0;

  for (let i = 0; i < toolkits.length; i += CHUNK_SIZE) {
    const chunk = toolkits.slice(i, i + CHUNK_SIZE);

    const results = await Promise.all(
      chunk.map(async (toolkit) => {
        const scheme = pickAuthScheme(toolkit);

        // Catalog rows only. A user's own server can share a slug with a
        // toolkit, and overwriting it here would hand them somebody else's
        // configuration.
        const existing = await prisma.mcpServer.findUnique({
          where: { slug: toolkit.slug },
          select: { id: true, ownerId: true, composioAuthScheme: true },
        });

        if (existing?.ownerId) return "skipped" as const;

        const shared = {
          name: toolkit.name,
          description: toolkit.description,
          iconUrl: toolkit.logo,
          docsUrl: `https://composio.dev/toolkits/${toolkit.slug}`,
          url: null,
          transport: "HTTP" as const,
          authType: "COMPOSIO" as const,
          composioToolkit: toolkit.slug,
          composioAuthScheme: scheme,
          composioManagedAuth:
            scheme !== null &&
            toolkit.composioManagedAuthSchemes.includes(scheme),
          categories: toolkit.categories,
          // Inverted so that higher sorts first in SQL, which keeps the
          // catalog's ORDER BY the same shape as every other "newest first"
          // query in the app.
          popularity: toolkits.length - toolkit.rank,
          isEnabled: true,
        };

        if (!existing) {
          await prisma.mcpServer.create({
            data: { slug: toolkit.slug, ...shared },
          });
          return "created" as const;
        }

        // A toolkit that changed scheme invalidates the auth config built for
        // the old one, so drop the cached id and let the next connect rebuild
        // it. Leaving it would create accounts against a config whose shape no
        // longer matches what we ask the user for.
        const schemeChanged =
          existing.composioAuthScheme !== null &&
          existing.composioAuthScheme !== scheme;

        await prisma.mcpServer.update({
          where: { id: existing.id },
          data: schemeChanged
            ? { ...shared, composioAuthConfigId: null }
            : shared,
        });
        return "updated" as const;
      }),
    );

    for (const result of results) {
      if (result === "created") created += 1;
      if (result === "updated") updated += 1;
    }
  }

  // Toolkits Composio has dropped are disabled, not deleted: a user may still
  // have a connection row pointing at one, and `isEnabled` is exactly the flag
  // that hides a server without breaking those references.
  const live = toolkits.map((toolkit) => toolkit.slug);
  const { count: retired } = await prisma.mcpServer.updateMany({
    where: {
      ownerId: null,
      authType: "COMPOSIO",
      isEnabled: true,
      slug: { notIn: live },
    },
    data: { isEnabled: false },
  });

  console.log(
    `Synced ${toolkits.length} Composio toolkits: ` +
      `${created} added, ${updated} updated, ${retired} retired.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
