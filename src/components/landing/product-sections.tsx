import {
  BookOpen,
  CalendarDays,
  CreditCard,
  FolderInput,
  GitPullRequest,
  LayoutGrid,
  Mail,
  MessageSquare,
  Workflow,
} from "lucide-react";
import { ReadableAutomation } from "@/components/landing/after-hero";
import { RunNotifications } from "@/components/landing/run-notifications";
import { WorkflowPreview } from "@/components/landing/workflow-preview";

const STEPS = [
  {
    n: "01",
    title: "Describe it",
    lead: "A sentence is enough.",
    body: "Write what you want. If something is ambiguous — which inbox, what time — it asks instead of guessing.",
    sample: "Every Thursday, draft a summary of unread mail.",
  },
  {
    n: "02",
    title: "Review the graph",
    lead: "Words become steps you can inspect.",
    body: "A trigger, tool calls and model steps you can rewire, edit, or change by asking. Nothing is hidden behind a prompt.",
    sample: "gmail.fetch_emails → model.summarize",
  },
  {
    n: "03",
    title: "Schedule and run",
    lead: "Test first. Then switch it on.",
    body: "Walk the whole workflow without calling a tool. When it looks right, put it on a schedule. Every run is logged.",
    sample: "Test run · Nothing was sent",
  },
];

const TOOLS = [
  { name: "Gmail", category: "Mail", tint: "bg-[#EA4335]", Icon: Mail },
  { name: "GitHub", category: "Code", tint: "bg-zinc-900 dark:bg-zinc-100", Icon: GitPullRequest },
  { name: "Slack", category: "Chat", tint: "bg-[#4A154B]", Icon: MessageSquare },
  { name: "Notion", category: "Docs", tint: "bg-zinc-800 dark:bg-zinc-200", Icon: BookOpen },
  { name: "Linear", category: "Issues", tint: "bg-[#5E6AD2]", Icon: Workflow },
  { name: "Calendar", category: "Time", tint: "bg-[#4285F4]", Icon: CalendarDays },
  { name: "Jira", category: "Work", tint: "bg-[#0052CC]", Icon: LayoutGrid },
  { name: "Stripe", category: "Money", tint: "bg-[#635BFF]", Icon: CreditCard },
  { name: "HubSpot", category: "CRM", tint: "bg-[#FF7A59]", Icon: LayoutGrid },
  { name: "Airtable", category: "Data", tint: "bg-[#18BFFF]", Icon: FolderInput },
];

export function ProductSections() {
  return (
    <>
      <section id="product" className="relative z-10 -mt-28 scroll-mt-24 px-6">
        <div className="mx-auto max-w-6xl">
          <WorkflowPreview />

          <div className="mt-24 sm:mt-28">
            <RunNotifications />
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto mt-28 max-w-6xl scroll-mt-24 px-6">
        <p className="text-sm font-medium text-brand">How it works</p>
        <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
          From a sentence to a running workflow.
        </h2>

        <ol className="mt-14 divide-y divide-border border-y border-border">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="grid gap-3 py-10 sm:grid-cols-[5.5rem_minmax(0,1fr)] lg:grid-cols-[5.5rem_minmax(0,16rem)_minmax(0,1fr)] lg:gap-10"
            >
              <span className="font-mono text-sm text-brand">{step.n}</span>
              <div>
                <h3 className="text-xl font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-1 text-sm text-foreground/80">{step.lead}</p>
              </div>
              <div className="sm:col-start-2 lg:col-start-3">
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                <p className="mt-4 font-mono text-[12px] text-subtle">{step.sample}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ReadableAutomation />

      <section id="integrations" className="mx-auto mt-28 max-w-6xl scroll-mt-24 px-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-brand">The stack</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
              Tools your team already lives in.
            </h2>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Eight hundred more through MCP. Connect with OAuth or an API key.
          </p>
        </div>

        <ul className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-5">
          {TOOLS.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col gap-4 bg-card px-4 py-5"
            >
              <span
                className={`flex size-9 items-center justify-center rounded-lg text-white ${tool.tint} ${
                  tool.name === "GitHub" || tool.name === "Notion"
                    ? "dark:text-zinc-900"
                    : ""
                }`}
              >
                <tool.Icon className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{tool.name}</p>
                <p className="text-xs text-muted-foreground">{tool.category}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
