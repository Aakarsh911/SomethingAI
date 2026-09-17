import { timingSafeEqual } from "node:crypto";
import { runDueWorkflows } from "@/lib/workflows/runtime";

export const dynamic = "force-dynamic";

/**
 * Runs every workflow that is due.
 *
 * Unauthenticated in the Clerk sense — there is no user behind a cron call —
 * so a shared secret is the whole access control. Vercel Cron sends it as a
 * bearer token; `curl -H "Authorization: Bearer $CRON_SECRET"` works the same
 * in development.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Refusing is the safe default: without a secret this endpoint would run
    // other people's workflows for anyone who found the URL.
    return Response.json(
      { error: "CRON_SECRET is not set, so the scheduler is disabled." },
      { status: 503 },
    );
  }

  if (!isAuthorized(request, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const results = await runDueWorkflows();

  return Response.json({
    ran: results.length,
    tookMs: Date.now() - started,
    runs: results.map((result) => ({
      workflowId: result.workflowId,
      runId: result.summary?.runId ?? null,
      status: result.summary?.status ?? "FAILED",
      error: result.summary?.error ?? null,
    })),
  });
}

function isAuthorized(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  // Length is compared separately because timingSafeEqual throws on a
  // mismatch rather than returning false.
  return a.length === b.length && timingSafeEqual(a, b);
}
