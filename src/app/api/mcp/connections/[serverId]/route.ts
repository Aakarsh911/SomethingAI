import { getCurrentUser, unauthorized } from "@/lib/auth";
import { disconnect } from "@/lib/mcp/connections";

export const dynamic = "force-dynamic";

/**
 * Disconnects the caller from a server: revokes the token upstream where
 * possible and drops the local connection row. OAuth servers can be
 * reconnected afterwards via /api/mcp/oauth/[serverId]/start.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { serverId } = await params;
  const removed = await disconnect(user.id, serverId);

  if (!removed) {
    return Response.json({ error: "Not connected." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
