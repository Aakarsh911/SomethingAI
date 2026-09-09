import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// Never cache: each call must verify a fresh signature against the raw body.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let event;
  try {
    // Reads CLERK_WEBHOOK_SIGNING_SECRET and checks the svix signature headers.
    event = await verifyWebhook(req);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const { id, email_addresses, primary_email_address_id, first_name, last_name, image_url } =
        event.data;
      const primaryEmail = email_addresses.find(
        (e) => e.id === primary_email_address_id,
      )?.email_address;
      if (!primaryEmail) break;

      await prisma.user.upsert({
        where: { clerkId: id },
        create: {
          clerkId: id,
          email: primaryEmail,
          firstName: first_name,
          lastName: last_name,
          imageUrl: image_url,
        },
        update: {
          email: primaryEmail,
          firstName: first_name,
          lastName: last_name,
          imageUrl: image_url,
        },
      });
      break;
    }
    case "user.deleted": {
      if (!event.data.id) break;
      await prisma.user.deleteMany({ where: { clerkId: event.data.id } });
      break;
    }
  }

  return Response.json({ received: true });
}
