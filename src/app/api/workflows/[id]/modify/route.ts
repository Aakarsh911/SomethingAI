import { getCurrentUser, unauthorized } from "@/lib/auth";
import {
  availableToolsForUser,
  connectedAccountsForUser,
} from "@/lib/ai/tool-catalog";
import {
  GenerationError,
  generateWorkflowDraft,
  type BuilderMessage,
} from "@/lib/ai/generate-workflow";
import { parseGraph, type WorkflowGraph } from "@/lib/workflows/graph";
import { isValidTimezone, ScheduleError } from "@/lib/workflows/schedule";
import {
  getWorkflow,
  listVersions,
  updateWorkflow,
} from "@/lib/workflows/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const messages = readMessages(body.messages);
  if (!messages) {
    return Response.json(
      { error: "Describe how you want to change this workflow." },
      { status: 400 },
    );
  }
  if (
    messages.length > 20 ||
    messages.some((message) => message.content.length > 2000)
  ) {
    return Response.json(
      { error: "That edit conversation is too long." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const workflow = await getWorkflow(user.id, id);
  if (!workflow) {
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  }

  const parsed = parseGraph(workflow.graph);
  if (!parsed.success) {
    return Response.json(
      { error: "The stored workflow graph is invalid." },
      { status: 422 },
    );
  }
  if (!isLinearGraph(parsed.data)) {
    return Response.json(
      {
        error:
          "Text editing currently supports linear workflows, not branches or disconnected nodes.",
      },
      { status: 422 },
    );
  }
  if (workflow.trigger === "WEBHOOK") {
    return Response.json(
      {
        error:
          "Text editing currently supports manual and scheduled workflows, not webhook triggers.",
      },
      { status: 422 },
    );
  }

  const claimed =
    typeof body.timezone === "string" ? body.timezone.trim() : "";
  const timezone = isValidTimezone(claimed) ? claimed : "UTC";
  const [tools, accounts] = await Promise.all([
    availableToolsForUser(user.id),
    connectedAccountsForUser(user.id),
  ]);

  try {
    const result = await generateWorkflowDraft({
      messages,
      tools,
      timezone,
      identity: { email: user.email, accounts },
      existing: {
        name: workflow.name,
        description: workflow.description,
        graph: parsed.data,
        trigger: workflow.trigger,
        cron: workflow.cron,
        timezone: workflow.timezone,
      },
    });

    if (result.kind === "questions") {
      return Response.json({ questions: result.questions });
    }

    const latestInstruction =
      messages.find((message) => message.role === "user")?.content ??
      "Updated with AI";
    const updated = await updateWorkflow(user.id, workflow.id, {
      name: result.draft.name.slice(0, 120),
      description: result.draft.description.slice(0, 2000),
      graph: result.draft.graph,
      trigger: result.draft.trigger,
      cron: result.draft.cron,
      timezone: result.draft.timezone,
      versionNote: `AI edit: ${latestInstruction.slice(0, 100)}`,
    });
    if (!updated) {
      return Response.json({ error: "Workflow not found." }, { status: 404 });
    }

    const versions = await listVersions(user.id, workflow.id);
    return Response.json({
      workflow: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        trigger: updated.trigger,
        cron: updated.cron,
        timezone: updated.timezone,
        graph: updated.graph,
        updatedAt: updated.updatedAt.toISOString(),
      },
      versions: versions.map((version) => ({
        id: version.id,
        revision: version.revision,
        note: version.note,
        createdAt: version.createdAt.toISOString(),
      })),
      droppedArgs: result.draft.droppedArgs,
    });
  } catch (error) {
    if (error instanceof GenerationError || error instanceof ScheduleError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("workflow modification failed", error);
    return Response.json(
      { error: "Could not change the workflow just now. Try again." },
      { status: 502 },
    );
  }
}

function readMessages(value: unknown): BuilderMessage[] | null {
  if (!Array.isArray(value)) return null;

  const messages = value
    .filter(
      (entry): entry is { role: unknown; content: unknown } =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      role:
        entry.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
      content:
        typeof entry.content === "string" ? entry.content.trim() : "",
    }))
    .filter((message) => message.content.length > 0);

  return messages.length > 0 ? messages : null;
}

function isLinearGraph(graph: WorkflowGraph): boolean {
  const trigger = graph.nodes.find((node) => node.kind === "trigger");
  if (!trigger) return false;
  if (graph.nodes.some((node) => node.kind === "branch")) return false;
  if (graph.edges.length !== graph.nodes.length - 1) return false;

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const edge of graph.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  if ((incoming.get(trigger.id) ?? 0) !== 0) return false;
  if (
    graph.nodes.some(
      (node) =>
        (outgoing.get(node.id)?.length ?? 0) > 1 ||
        (node.id !== trigger.id && (incoming.get(node.id) ?? 0) !== 1),
    )
  ) {
    return false;
  }

  const visited = new Set<string>();
  let current: string | undefined = trigger.id;
  while (current && !visited.has(current)) {
    visited.add(current);
    current = outgoing.get(current)?.[0];
  }
  return visited.size === graph.nodes.length;
}
