import { getCurrentUser, unauthorized } from "@/lib/auth";
import { availableToolsForUser } from "@/lib/ai/tool-catalog";

export const dynamic = "force-dynamic";

/** Enough to tell two tools apart in a dropdown, without shipping an essay. */
const BLURB_LIMIT = 160;

export type ToolListItem = {
  toolSlug: string;
  description: string;
};

export type ToolListServer = {
  serverSlug: string;
  serverName: string;
  tools: ToolListItem[];
};

/**
 * The tools the caller can pick from, grouped by the server that provides
 * them.
 *
 * Deliberately without argument schemas. A connected toolkit can carry a
 * hundred tools, each with a dozen documented parameters, and sending all of
 * that so the user can choose one is most of a megabyte spent to render a
 * dropdown. The schema for the tool actually chosen is one more request, to
 * GET /api/tools/[serverSlug]/[toolSlug], and lands against the same
 * ten-minute server-side cache.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const tools = await availableToolsForUser(user.id);

  const byServer = new Map<string, ToolListServer>();
  for (const tool of tools) {
    let group = byServer.get(tool.serverSlug);
    if (!group) {
      group = {
        serverSlug: tool.serverSlug,
        serverName: tool.serverName,
        tools: [],
      };
      byServer.set(tool.serverSlug, group);
    }

    group.tools.push({
      toolSlug: tool.toolSlug,
      description: tool.description.slice(0, BLURB_LIMIT),
    });
  }

  const servers = [...byServer.values()].map((group) => ({
    ...group,
    // Alphabetical because Composio's order is neither stable nor meaningful,
    // and a dropdown that reshuffles between loads is hard to use.
    tools: group.tools.sort((a, b) => a.toolSlug.localeCompare(b.toolSlug)),
  }));

  return Response.json({ servers });
}
