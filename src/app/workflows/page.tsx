import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listWorkflows } from "@/lib/workflows/store";
import { describeSchedule } from "@/lib/workflows/schedule";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workflows",
};

/**
 * Minimal list so saving a generated workflow lands somewhere real. The
 * richer view belongs with the rest of the frontend work.
 */
export default async function WorkflowsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const workflows = await listWorkflows(user.id);

  return (
    <div className="mx-auto w-full max-w-[800px] px-6 py-12 min-[600px]:px-[60px]">
      <div className="flex flex-col gap-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-medium text-black dark:text-[#ededed]">
            Workflows
          </h1>
          <Link
            href="/workflows/new"
            className="text-sm font-medium text-black underline underline-offset-4 dark:text-[#ededed]"
          >
            New workflow
          </Link>
        </div>

        {workflows.length === 0 ? (
          <p className="rounded-xl border border-[#ebebeb] p-4 text-sm text-[#666] dark:border-[#1a1a1a] dark:text-[#999]">
            Nothing here yet.{" "}
            <Link
              href="/workflows/new"
              className="font-medium text-black underline underline-offset-4 dark:text-[#ededed]"
            >
              Describe one in plain English
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {workflows.map((workflow) => (
              <li
                key={workflow.id}
                className="flex flex-col gap-2 rounded-xl border border-[#ebebeb] p-4 dark:border-[#1a1a1a]"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-medium text-black dark:text-[#ededed]">
                    {workflow.name}
                  </p>
                  <span className="shrink-0 text-sm text-[#666] dark:text-[#999]">
                    {workflow.isEnabled ? "Enabled" : "Off"}
                  </span>
                </div>

                {workflow.description && (
                  <p className="text-sm text-[#666] dark:text-[#999]">
                    {workflow.description}
                  </p>
                )}

                <p className="text-sm text-[#666] dark:text-[#999]">
                  {workflow.cron && workflow.timezone
                    ? describeSchedule(workflow.cron, workflow.timezone)
                    : "Runs only when triggered"}
                </p>

                {workflow.serverSlugs.length > 0 && (
                  <p className="font-mono text-xs break-all text-[#999] dark:text-[#666]">
                    {workflow.serverSlugs.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
