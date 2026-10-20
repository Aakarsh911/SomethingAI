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

const SPECS = [
  {
    title: "800+ tools through MCP",
    body: "Connect Gmail, GitHub, Slack and hundreds more with OAuth or an API key. Bring your own MCP server if the catalog is missing one.",
  },
  {
    title: "Edit by asking",
    body: "“Also post it to Slack.” Changes compile into a new version of the graph, not a silent rewrite of the last prompt.",
  },
  {
    title: "Safe test runs",
    body: "Walk every step without sending mail, opening tickets, or calling a single tool. Live runs are a separate action.",
  },
  {
    title: "Version history",
    body: "Every save is a revision. Restore any of them in one click if an edit goes the wrong way.",
  },
  {
    title: "Encrypted credentials",
    body: "Tokens are sealed with AES-256-GCM at rest and refreshed for you. Nothing is shared between accounts.",
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
          <div className="glass-strong rounded-[1.75rem] p-2 shadow-[0_40px_90px_-40px_rgb(0_0_0/0.45)] dark:shadow-[0_40px_90px_-36px_rgb(0_0_0/0.85)]">
            <WorkflowPreview />
          </div>

          <div className="mt-8">
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

      <section id="features" className="mx-auto mt-28 max-w-6xl scroll-mt-24 px-6">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-sm font-medium text-brand">Built for trust</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
              Automation you can actually read.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              No black boxes. Every workflow is a graph you inspect before it
              touches an inbox, a ticket, or a channel.
            </p>
          </div>

          <dl className="divide-y divide-border border-y border-border">
            {SPECS.map((spec) => (
              <div key={spec.title} className="grid gap-2 py-7 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-8">
                <dt className="text-[15px] font-semibold tracking-tight">{spec.title}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{spec.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

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
