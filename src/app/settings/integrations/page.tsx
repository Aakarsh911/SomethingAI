import Link from "next/link";
import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { getCurrentUser } from "@/lib/auth";
import { countServersForUser, listServersForUser } from "@/lib/mcp/servers";
import { IntegrationsList } from "./integrations-list";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrations",
};

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
    <div className="min-h-[100dvh] bg-[#fafafa] dark:bg-[#0a0a0a]">
      <header className="border-b border-[#ebebeb] bg-white dark:border-[#262626] dark:bg-neutral-950">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/workflows"
              className="text-sm font-medium text-[#666] transition hover:text-black dark:text-[#999] dark:hover:text-[#ededed]"
            >
              ← Workflows
            </Link>
            <div>
              <h1 className="text-lg font-semibold tracking-[-0.3px]">Integrations</h1>
              <p className="text-xs text-[#666] dark:text-[#999]">
                {total.toLocaleString()} available · {connections.length} connected
              </p>
            </div>
          </div>
          <UserButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        {error ? (
          <p
            role="alert"
            className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}

        {connectedServer ? (
          <p className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
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
      </main>
    </div>
  );
}
