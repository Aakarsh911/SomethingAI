import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { describeComposioAccount } from "@/lib/mcp/composio";
import type { McpConnectAttemptModel } from "@/generated/prisma/models";

export const dynamic = "force-dynamic";

/**
 * Composio appends its own parameters to the callback URL, and has used both
 * snake_case and camelCase depending on which flow started the request, so
 * accept either rather than silently failing on the wrong one.
 */
function readParam(url: URL, ...names: string[]): string | null {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * Where Composio sends the browser after the user authorizes.
 *
 * The `state` row is consumed with a delete that returns it, so the lookup and
 * the invalidation are one atomic step and a replayed callback finds nothing.
 * The user and server come from that row rather than the query string, so a
 * forged callback cannot attach an account to somebody else.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  let done = new URL("/settings/integrations", requestUrl.origin);

  const fail = (message: string) => {
    done.searchParams.set("error", message);
    return NextResponse.redirect(done);
  };

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", requestUrl.origin));
  }

  const state = requestUrl.searchParams.get("state");
  if (!state) return fail("The authorization response was incomplete.");

  let attempt: McpConnectAttemptModel;
  try {
    attempt = await prisma.mcpConnectAttempt.delete({ where: { state } });
  } catch {
    return fail("This authorization link was already used or has expired.");
  }

  if (attempt.expiresAt < new Date()) {
    return fail("Authorization timed out. Please try connecting again.");
  }

  if (attempt.userId !== user.id) {
    return fail("This authorization was started by a different account.");
  }

  // Safe against open redirects: `returnTo` was validated as a same-origin
  // path before being stored, and resolving it against our own origin keeps
  // it there.
  if (attempt.returnTo) {
    done = new URL(attempt.returnTo, requestUrl.origin);
  }

  const server = await prisma.mcpServer.findUnique({
    where: { id: attempt.serverId },
  });
  if (!server) return fail("That server is no longer available.");

  const status = readParam(requestUrl, "status");
  if (status && status.toLowerCase() !== "success") {
    return fail(`${server.name} was not connected: authorization ${status}.`);
  }

  const connectedAccountId = readParam(
    requestUrl,
    "connected_account_id",
    "connectedAccountId",
  );
  if (!connectedAccountId) {
    return fail("Composio did not return a connected account.");
  }

  // Trust Composio's own view of the account rather than the query string,
  // which is attacker-controllable up to the point of guessing an id.
  const account = await describeComposioAccount(connectedAccountId);
  if (!account) return fail("Composio did not recognise that connection.");

  await prisma.userMcpConnection.upsert({
    where: { userId_serverId: { userId: user.id, serverId: server.id } },
    create: {
      userId: user.id,
      serverId: server.id,
      status: account.isActive ? "CONNECTED" : "PENDING",
      externalAccountId: connectedAccountId,
      accountLabel: account.accountLabel,
      connectedAt: account.isActive ? new Date() : null,
    },
    update: {
      status: account.isActive ? "CONNECTED" : "PENDING",
      externalAccountId: connectedAccountId,
      accountLabel: account.accountLabel,
      connectedAt: account.isActive ? new Date() : null,
      lastError: null,
    },
  });

  if (!account.isActive) {
    return fail(
      `${server.name} is still finishing authorization. Refresh in a moment.`,
    );
  }

  done.searchParams.set("connected", server.slug);
  return NextResponse.redirect(done);
}
