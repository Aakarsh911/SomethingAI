import { getCurrentUser, unauthorized } from "@/lib/auth";
import { listServersForUser } from "@/lib/mcp/servers";

export const dynamic = "force-dynamic";

/** Just the servers the caller has actually connected. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const servers = await listServersForUser(user.id, { connectedOnly: true });

  return Response.json({
    connections: servers.filter((server) => server.connection !== null),
  });
}
