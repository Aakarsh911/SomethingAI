import { AppHeader } from "@/components/app-header";
import type { CommandWorkflow } from "@/components/command-menu";

export function AppShell({
  workflows,
  children,
}: {
  workflows: CommandWorkflow[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <AppHeader workflows={workflows} />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
