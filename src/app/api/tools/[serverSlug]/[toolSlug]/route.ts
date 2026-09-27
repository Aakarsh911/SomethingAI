import { getCurrentUser, unauthorized } from "@/lib/auth";
import {
  availableToolsForUser,
  type ToolParameter,
} from "@/lib/ai/tool-catalog";

export const dynamic = "force-dynamic";

export type ToolDetail = {
  serverSlug: string;
  serverName: string;
  toolSlug: string;
  description: string;
  schema: ToolParameter[];
};

/**
 * One tool's argument schema, for rendering its form.
 *
 * Resolved from the caller's own connected tools rather than the whole
 * Composio catalog, so a request naming a tool from a server the user has not
 * connected 404s instead of describing a form they cannot run.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverSlug: string; toolSlug: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { serverSlug, toolSlug } = await params;
  const tools = await availableToolsForUser(user.id);

  const tool = tools.find(
    (candidate) =>
      candidate.serverSlug === serverSlug && candidate.toolSlug === toolSlug,
  );

  if (!tool) {
    return Response.json({ error: "Tool not found." }, { status: 404 });
  }

  const detail: ToolDetail = {
    serverSlug: tool.serverSlug,
    serverName: tool.serverName,
    toolSlug: tool.toolSlug,
    description: tool.description,
    schema: tool.schema,
  };

  return Response.json({ tool: detail });
}
