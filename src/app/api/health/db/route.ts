import { prisma } from "@/lib/db";

// Never cache this at build time — a cached "ok" would be meaningless.
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    // A raw query, so this works even though the schema defines no models yet.
    // It still exercises the full path: env var -> client -> driver -> server.
    await prisma.$queryRaw`SELECT 1`;

    return Response.json({ ok: true, latencyMs: Date.now() - startedAt });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
