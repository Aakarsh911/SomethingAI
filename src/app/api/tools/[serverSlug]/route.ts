import { getCurrentUser, unauthorized } from "@/lib/auth";
import { availableToolsForUser, type ToolParameter } from "@/lib/ai/tool-catalog";

export const dynamic = "force-dynamic";

export type ServerTool = {
  toolSlug: string;
  description: string;
  schema: ToolParameter[];
};

/** A connected server's tools with argument schemas; empty if not connected. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverSlug: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { serverSlug } = await params;
  const tools: ServerTool[] = (await availableToolsForUser(user.id))
    .filter((tool) => tool.serverSlug === serverSlug)
    .map(({ toolSlug, description, schema }) => ({ toolSlug, description, schema }))
    // Composio's order is neither stable nor meaningful.
    .sort((a, b) => a.toolSlug.localeCompare(b.toolSlug));

  return Response.json({ tools });
}
