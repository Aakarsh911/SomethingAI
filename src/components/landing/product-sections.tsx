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
import { HowStaircase } from "@/components/landing/how-staircase";
import { WorkflowPreview } from "@/components/landing/workflow-preview";

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
      <section id="product" className="relative z-10">
        <WorkflowPreview />
      </section>

      <HowStaircase />

      <ReadableAutomation />

      <section id="integrations" className="mx-auto mt-28 max-w-6xl px-6">
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
