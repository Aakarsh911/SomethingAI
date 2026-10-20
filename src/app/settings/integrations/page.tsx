import { redirect } from "next/navigation";
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
    <div className="h-full overflow-y-auto bg-canvas">
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.16em] text-brand uppercase">
              Directory
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">
              Integrations
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              OAuth or an API key. Tokens stay sealed to your account.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-ok" />
              {connections.length} connected
            </span>
            <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              {total.toLocaleString()} available
            </span>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {connectedServer ? (
          <p className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
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
