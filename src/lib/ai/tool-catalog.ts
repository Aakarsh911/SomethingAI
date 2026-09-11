import { prisma } from "@/lib/db";

/**
 * The set of MCP tools a user can actually call, fetched from Composio.
 *
 * This exists because the model must emit real tool slugs. Left to its own
 * knowledge it will produce something plausible like `gmail_get_messages`,
 * the workflow will save cleanly because nothing in the database checks tool
 * names, and it will fail only when it finally runs — possibly weeks later on
 * a schedule, with nobody watching. Grounding the prompt in the live list is
 * cheaper than detecting that after the fact.
 */

export type AvailableTool = {
  serverSlug: string;
  serverName: string;
  toolSlug: string;
  description: string;
  /**
   * Accepted argument names, from the tool's own input schema.
   *
   * Carried through because slugs are not the only thing the model gets
   * wrong: left to guess, it writes readable keys like "max results" where
   * the tool wants "max_results", and the argument is silently discarded at
   * call time. Knowing the real names lets the prompt state them and the
   * validator reject anything else.
   */
  parameters: string[];
};

const COMPOSIO_API = "https://backend.composio.dev/api/v3";

/**
 * Composio's tool list per toolkit is stable over a session and costs a
 * round trip, so it is cached in module scope. Short TTL rather than none:
 * toolkits do gain tools, and a stale list silently narrows what users can
 * build.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; tools: AvailableTool[] }>();

type ComposioTool = {
  slug?: string;
  name?: string;
  description?: string;
  input_parameters?: { properties?: Record<string, unknown> };
};

async function fetchToolkitTools(
  toolkit: string,
  serverSlug: string,
  serverName: string,
): Promise<AvailableTool[]> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return [];

  const cached = cache.get(toolkit);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.tools;

  const response = await fetch(
    `${COMPOSIO_API}/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=100`,
    { headers: { "x-api-key": apiKey } },
  );

  if (!response.ok) {
    // A toolkit that cannot be listed is left out rather than throwing: the
    // user can still build workflows from whatever else they have connected.
    return [];
  }

  const body = (await response.json()) as { items?: ComposioTool[] };
  const tools: AvailableTool[] = (body.items ?? [])
    .filter((tool): tool is ComposioTool & { slug: string } => Boolean(tool.slug))
    .map((tool) => ({
      serverSlug,
      serverName,
      toolSlug: tool.slug,
      description: tool.description ?? tool.name ?? "",
      parameters: Object.keys(tool.input_parameters?.properties ?? {}),
    }));

  cache.set(toolkit, { at: Date.now(), tools });
  return tools;
}

/**
 * Tools from the servers this user has actually connected.
 *
 * Deliberately not the whole catalog: offering Gmail tools to someone who has
 * not connected Gmail produces a workflow that cannot run, and the failure
 * shows up at execution rather than at generation time.
 */
export async function availableToolsForUser(
  userId: string,
): Promise<AvailableTool[]> {
  const connections = await prisma.userMcpConnection.findMany({
    where: { userId, status: "CONNECTED" },
    select: {
      server: {
        select: { slug: true, name: true, composioToolkit: true, isEnabled: true },
      },
    },
  });

  const toolLists = await Promise.all(
    connections
      .map((connection) => connection.server)
      .filter((server) => server.isEnabled && server.composioToolkit)
      .map((server) =>
        fetchToolkitTools(server.composioToolkit!, server.slug, server.name),
      ),
  );

  return toolLists.flat();
}

/** Compact rendering for the prompt. One line per tool keeps the list cheap. */
export function renderToolsForPrompt(tools: AvailableTool[]): string {
  if (tools.length === 0) {
    return "(none — the user has not connected any MCP servers yet)";
  }

  return tools
    .map((tool) => {
      const args =
        tool.parameters.length > 0
          ? `\n    args: ${tool.parameters.join(", ")}`
          : "";
      return `- ${tool.toolSlug} (server: ${tool.serverSlug}) — ${tool.description.slice(0, 120)}${args}`;
    })
    .join("\n");
}

/**
 * Drops argument names the tool does not accept, after trying to repair the
 * near-misses the model actually produces: "max results" and "maxResults"
 * both mean "max_results".
 *
 * Unrecognised keys are removed rather than passed through, because Composio
 * rejects or ignores them, and returned so the caller can tell the user what
 * was discarded instead of leaving a step quietly missing an argument.
 */
export function reconcileToolInputs(
  inputs: Record<string, unknown>,
  parameters: string[],
): { inputs: Record<string, unknown>; dropped: string[] } {
  if (parameters.length === 0) return { inputs, dropped: [] };

  const canonical = new Map(
    parameters.map((name) => [name.toLowerCase().replace(/[^a-z0-9]/g, ""), name]),
  );

  const result: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(inputs)) {
    const match = canonical.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (match) result[match] = value;
    else dropped.push(key);
  }

  return { inputs: result, dropped };
}
