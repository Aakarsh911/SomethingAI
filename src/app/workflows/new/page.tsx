import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import FlowField from "@/components/kokonutui/flow-field";
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

  const connections = await prisma.userMcpConnection.count({
    where: { userId: user.id, status: "CONNECTED" },
  });

  return (
    <div className="relative h-full overflow-hidden bg-canvas">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-[28rem] w-[44rem] -translate-x-1/2 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute top-1/3 -left-16 h-72 w-72 rounded-full bg-live/20 blur-3xl" />
        <div className="absolute right-0 bottom-0 h-80 w-80 rounded-full bg-ok/15 blur-3xl" />
      </div>
      <FlowField
        className="text-brand/50 dark:text-brand/40"
        density={0.7}
        speed={0.7}
      />

      <div className="relative z-10 flex h-full flex-col">
        <header className="shrink-0 px-6 pt-6 min-[600px]:px-10">
          <Link
            href="/workflows"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur-xl transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Workflows
          </Link>
        </header>

        <WorkflowChat hasConnections={connections > 0} />
      </div>
    </div>
  );
}
