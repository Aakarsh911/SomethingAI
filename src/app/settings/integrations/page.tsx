import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { countServersForUser, listServersForUser } from "@/lib/mcp/servers";
import { IntegrationsList } from "./integrations-list";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrations",
};

/**
 * How much of the catalog one page shows. Composio brokers ~1500
 * integrations, so browsing is search-first: the rest are a query away
 * rather than a scroll away.
 */
const PAGE_SIZE = 24;

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { error, connected, q } = await searchParams;
  const query = q?.trim() || undefined;

  // The user's own connections are fetched separately from the catalog slice
  // so they stay pinned to the top of the page. Folding them into the same
  // query would drop a connected integration out of view as soon as a search
  // did not match it.
  const [connections, servers, total] = await Promise.all([
    listServersForUser(user.id, { connectedOnly: true }),
    listServersForUser(user.id, { query, limit: PAGE_SIZE }),
    countServersForUser(user.id, { query }),
  ]);

  const connectedIds = new Set(connections.map((server) => server.id));
  const catalog = servers.filter((server) => !connectedIds.has(server.id));

  const connectedServer = connected
    ? connections.find((server) => server.slug === connected)
    : undefined;

  return (
    <div className="mx-auto w-full max-w-[800px] px-6 py-12 min-[600px]:px-[60px]">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-[32px] leading-10 font-semibold tracking-[-1.92px] text-black dark:text-[#ededed]">
          Integrations
        </h1>
        <p className="text-[#666] dark:text-[#999]">
          Connect MCP servers to give your assistant access to your tools. You
          can revoke any connection at any time.
        </p>
        <p className="text-sm text-[#999] dark:text-[#666]">
          {total.toLocaleString()} integrations available.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {connectedServer ? (
        <p className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {connectedServer.name} is connected
          {connectedServer.connection?.accountLabel
            ? ` as ${connectedServer.connection.accountLabel}`
            : ""}
          .
        </p>
      ) : null}

      <IntegrationsList
        connections={connections}
        catalog={catalog}
        query={query ?? ""}
        total={total}
        shown={catalog.length}
      />
    </div>
  );
}
