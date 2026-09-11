import { getCurrentUser, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Removes a server the caller added. Scoping the delete by `ownerId` means a
 * request for a catalog row or someone else's server matches nothing and 404s
 * rather than deleting it. Connections cascade.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const { count } = await prisma.mcpServer.deleteMany({
    where: { id, ownerId: user.id },
  });

  if (count === 0) {
    return Response.json({ error: "Server not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
