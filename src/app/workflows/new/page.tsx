import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { WorkflowChat } from "./workflow-chat";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New workflow",
};

export default async function NewWorkflowPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Only the count is needed, and the tool list costs a round trip to
  // Composio, so that is left to the generate route.
  const connections = await prisma.userMcpConnection.count({
    where: { userId: user.id, status: "CONNECTED" },
  });

  return (
    <div className="mx-auto w-full max-w-[800px] px-6 py-12 min-[600px]:px-[60px]">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium text-black dark:text-[#ededed]">
            New workflow
          </h1>
          <p className="text-sm text-[#666] dark:text-[#999]">
            Describe an automation in your own words. You will see the steps
            before anything is saved.
          </p>
        </div>

        <WorkflowChat hasConnections={connections > 0} />
      </div>
    </div>
  );
}
