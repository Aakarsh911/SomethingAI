import { getServersBySlugs, type McpServerView } from "@/lib/mcp/servers";

export type ConnectNeed = {
  serverSlug: string;
  reason: string;
};

export type NeededConnection = {
  reason: string;
  server: McpServerView;
};

/** Turns model slugs into the server cards the connect panel can render. */
export async function hydrateNeededConnections(
  userId: string,
  needs: ConnectNeed[],
): Promise<NeededConnection[]> {
  const servers = await getServersBySlugs(
    userId,
    needs.map((need) => need.serverSlug),
  );
  const bySlug = new Map(servers.map((server) => [server.slug, server]));

  return needs.flatMap((need) => {
    const server = bySlug.get(need.serverSlug);
    if (!server || server.connection?.status === "CONNECTED") return [];
    return [{ reason: need.reason, server }];
  });
}
