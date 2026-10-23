import { getCurrentUser, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Returns configuration for Modulate transcription.
 * This endpoint provides the API key securely to authenticated users.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  if (!process.env.MODULATE_API_KEY) {
    return Response.json(
      { error: "MODULATE_API_KEY not configured" },
      { status: 500 }
    );
  }

  return Response.json({
    apiKey: process.env.MODULATE_API_KEY,
  });
}
