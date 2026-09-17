import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { startComposioConnect, usesRedirect } from "@/lib/mcp/composio";

export const dynamic = "force-dynamic";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

/**
 * Only same-origin paths may be returned to, so a crafted `returnTo` cannot
 * turn this into an open redirect. `//host` is rejected because browsers read
 * it as a protocol-relative absolute URL.
 */
function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

/**
 * Starts the Composio authorization flow for a server and bounces the browser
 * to the provider's consent screen. Navigated to directly, so it answers with
 * redirects rather than JSON.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const requestUrl = new URL(request.url);
  const integrations = new URL("/settings/integrations", requestUrl.origin);

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", requestUrl.origin));
  }

  const { serverId } = await params;
  const server = await prisma.mcpServer.findFirst({
    where: {
      id: serverId,
      isEnabled: true,
      OR: [{ ownerId: null }, { ownerId: user.id }],
    },
  });

  if (!server) {
    integrations.searchParams.set("error", "Server not found.");
    return NextResponse.redirect(integrations);
  }

  if (server.authType !== "COMPOSIO") {
    integrations.searchParams.set(
      "error",
      `${server.name} does not use a hosted authorization flow.`,
    );
    return NextResponse.redirect(integrations);
  }

  // Most Composio toolkits authenticate with a key rather than a consent
  // screen, and there is nowhere to send the browser for those. The UI
  // already renders a form instead of a link, so reaching here means a stale
  // page or a hand-typed URL.
  if (!usesRedirect(server)) {
    integrations.searchParams.set(
      "error",
      `${server.name} is connected by entering credentials, not by authorizing in a browser.`,
    );
    return NextResponse.redirect(integrations);
  }

  // Opportunistic sweep so abandoned attempts do not accumulate; there is no
  // cron in this app and these rows are worthless once expired.
  await prisma.mcpConnectAttempt.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  const state = randomBytes(32).toString("base64url");

  // The attempt row has to exist before Composio is called, because the
  // callback URL we hand over carries its `state`.
  const attempt = await prisma.mcpConnectAttempt.create({
    data: {
      state,
      userId: user.id,
      serverId: server.id,
      returnTo: safeReturnTo(requestUrl.searchParams.get("returnTo")),
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
    },
  });

  const callbackUrl = appUrl("/api/mcp/connect/callback");
  callbackUrl.searchParams.set("state", state);

  try {
    const { redirectUrl, requestId } = await startComposioConnect({
      server,
      userId: user.id,
      callbackUrl: callbackUrl.toString(),
    });

    if (requestId) {
      await prisma.mcpConnectAttempt.update({
        where: { id: attempt.id },
        data: { externalRequestId: requestId },
      });
    }

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    await prisma.mcpConnectAttempt.delete({ where: { id: attempt.id } });
    integrations.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Could not start authorization.",
    );
    return NextResponse.redirect(integrations);
  }
}
