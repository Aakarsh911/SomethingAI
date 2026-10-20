import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { listWorkflows } from "@/lib/workflows/store";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const workflows = await listWorkflows(user.id);

  return (
    <AppShell
      workflows={workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
      }))}
    >
      {children}
    </AppShell>
  );
}
