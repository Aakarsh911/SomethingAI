import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listServersForUser } from "@/lib/mcp/servers";
import { IntegrationsList } from "./integrations-list";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrations",
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [servers, { error, connected }] = await Promise.all([
    listServersForUser(user.id),
    searchParams,
  ]);

  const connectedServer = connected
    ? servers.find((server) => server.slug === connected)
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

      <IntegrationsList servers={servers} />
    </div>
  );
}
