import {
  Bot,
  Clock,
  GitPullRequest,
  Mail,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PreviewNode = {
  id: string;
  x: number;
  y: number;
  eyebrow: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
  tone: "trigger" | "tool" | "model";
};

const NODES: PreviewNode[] = [
  {
    id: "trigger",
    x: 4,
    y: 38,
    eyebrow: "Trigger",
    title: "Every Monday",
    detail: "9:00 AM · America/New_York",
    icon: <Clock className="size-3.5" />,
    tone: "trigger",
  },
  {
    id: "gmail",
    x: 36,
    y: 8,
    eyebrow: "gmail",
    title: "Fetch unread email",
    detail: "GMAIL_FETCH_EMAILS",
    icon: <Mail className="size-3.5" />,
    tone: "tool",
  },
  {
    id: "github",
    x: 36,
    y: 66,
    eyebrow: "github",
    title: "List open PRs",
    detail: "GITHUB_LIST_PULL_REQUESTS",
    icon: <GitPullRequest className="size-3.5" />,
    tone: "tool",
  },
  {
    id: "model",
    x: 68,
    y: 38,
    eyebrow: "Model",
    title: "Write the digest",
    detail: "Summarize both into 5 bullets",
    icon: <Bot className="size-3.5" />,
    tone: "model",
  },
];

const EDGES: [string, string][] = [
  ["trigger", "gmail"],
  ["trigger", "github"],
  ["gmail", "model"],
  ["github", "model"],
];

const NODE_W = 28;
const NODE_H = 26;

function anchor(node: PreviewNode, side: "in" | "out") {
  return {
    x: side === "out" ? node.x + NODE_W : node.x,
    y: node.y + NODE_H / 2,
  };
}

/** A static, scaled-down studio canvas, drawn in percentages so it reflows. */
export function WorkflowPreview() {
  const byId = new Map(NODES.map((node) => [node.id, node]));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)] dark:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-foreground/10" />
          <span className="size-2.5 rounded-full bg-foreground/10" />
          <span className="size-2.5 rounded-full bg-foreground/10" />
        </span>
        <span className="ml-2 text-xs font-medium text-muted-foreground">
          Monday engineering digest
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Scheduled
        </span>
      </div>

      <div className="relative aspect-[16/8] w-full bg-canvas [background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_12%,transparent)_1px,transparent_1px)] [background-size:18px_18px]">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {EDGES.map(([from, to]) => {
            const a = anchor(byId.get(from)!, "out");
            const b = anchor(byId.get(to)!, "in");
            const mid = (a.x + b.x) / 2;
            return (
              <path
                key={`${from}-${to}`}
                d={`M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                className={
                  from === "model" || to === "model"
                    ? "text-brand/55"
                    : "text-live/50"
                }
                strokeDasharray="4 4"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="16"
                  to="0"
                  dur="1.2s"
                  repeatCount="indefinite"
                />
              </path>
            );
          })}
        </svg>

        {NODES.map((node) => (
          <div
            key={node.id}
            className={cn(
              "absolute flex flex-col justify-center overflow-hidden rounded-xl border bg-card/90 px-3 py-2 shadow-sm backdrop-blur-md before:absolute before:inset-y-0 before:left-0 before:w-0.5",
              node.tone === "trigger" && "border-foreground/20 before:bg-foreground",
              node.tone === "tool" && "border-live/25 before:bg-live",
              node.tone === "model" &&
                "border-brand/40 bg-[color-mix(in_oklch,var(--brand)_8%,var(--card))] before:bg-brand",
            )}
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              width: `${NODE_W}%`,
              height: `${NODE_H}%`,
            }}
          >
            <p
              className={cn(
                "flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase",
                node.tone === "model" ? "text-brand" : "text-muted-foreground",
              )}
            >
              {node.icon}
              {node.eyebrow}
            </p>
            <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">
              {node.title}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {node.detail}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-4 py-3">
        <Sparkles className="size-4 shrink-0 text-brand" />
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          “Also post the digest to #eng-updates on Slack”
        </p>
        <span className="hidden items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex">
          <MessageSquare className="size-3" />
          Change
        </span>
      </div>
    </div>
  );
}
