import { CalendarClock, GitPullRequest, Mail, MessageSquare } from "lucide-react";

type Run = {
  id: string;
  tool: string;
  title: string;
  detail: string;
  time: string;
  tint: string;
  icon: React.ReactNode;
};

const RUNS: Run[] = [
  {
    id: "run-1",
    tool: "Slack",
    title: "Monday digest sent",
    detail: "23 emails and 6 open PRs → #eng-updates",
    time: "now",
    tint: "bg-[#4A154B]",
    icon: <MessageSquare className="size-3.5" />,
  },
  {
    id: "run-2",
    tool: "Gmail",
    title: "Follow-up labels applied",
    detail: "4 threads from your manager",
    time: "6:00",
    tint: "bg-[#EA4335]",
    icon: <Mail className="size-3.5" />,
  },
  {
    id: "run-3",
    tool: "GitHub",
    title: "Stale PR reminder",
    detail: "Pinged reviewers on 3 idle pull requests",
    time: "Tue",
    tint: "bg-zinc-900 dark:bg-zinc-200 dark:text-zinc-900",
    icon: <GitPullRequest className="size-3.5" />,
  },
  {
    id: "run-4",
    tool: "Calendar",
    title: "Tomorrow’s agenda drafted",
    detail: "5 meetings, 2 conflicts flagged",
    time: "Mon",
    tint: "bg-[#4285F4]",
    icon: <CalendarClock className="size-3.5" />,
  },
];

/** A product-shaped run log — not a notification toy. */
export function RunNotifications() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
        <div>
          <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Overnight
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            4 runs · nothing failed
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/25 bg-ok/10 px-2.5 py-1 text-[11px] font-medium text-ok">
          <span className="size-1.5 rounded-full bg-ok" />
          All succeeded
        </span>
      </header>

      <ul className="divide-y divide-border">
        {RUNS.map((run) => (
          <li key={run.id} className="flex items-start gap-3 px-5 py-3.5">
            <span
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-white ${run.tint}`}
            >
              {run.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium text-foreground">
                  {run.title}
                </p>
                <time className="shrink-0 font-mono text-[11px] text-subtle">
                  {run.time}
                </time>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {run.tool}
                <span className="text-subtle"> · </span>
                {run.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
