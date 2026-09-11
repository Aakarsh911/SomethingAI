import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { UserModel } from "@/generated/prisma/models";

/**
 * Resolves the signed-in Clerk session to the local `User` row that app data
 * hangs off, or null when nobody is signed in.
 *
 * The row normally already exists because of the Clerk webhook, but that
 * webhook needs a public URL, so in local development it usually never fires.
 * Rather than 500 on a perfectly valid session, fall back to reading the
 * profile from Clerk directly and upserting it.
 */
export async function getCurrentUser(): Promise<UserModel | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) return existing;

  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email = clerkUser.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId,
  )?.emailAddress;
  if (!email) return null;

  const profile = {
    email,
    firstName: clerkUser.firstName,
    lastName: clerkUser.lastName,
    imageUrl: clerkUser.imageUrl,
  };

  return prisma.user.upsert({
    where: { clerkId },
    create: { clerkId, ...profile },
    update: profile,
  });
}

/** `Response` helper so every MCP route rejects anonymous callers the same way. */
export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
