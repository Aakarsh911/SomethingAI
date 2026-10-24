"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  LayoutGrid,
  Monitor,
  Moon,
  Palette,
  Plug,
  Sparkles,
  Sun,
  Workflow,
} from "lucide-react";
import ActionSearchBar, { type CommandItem } from "@/components/kokonutui/action-search-bar";
import { setThemePreference, type ThemePreference } from "@/components/theme/theme";
import { cn } from "@/lib/utils";

export type CommandWorkflow = { id: string; name: string };

export function CommandMenu({
  workflows = [],
  className,
}: {
  workflows?: CommandWorkflow[];
  className?: string;
}) {
  const router = useRouter();

  const items = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      {
        id: "new-ai",
        label: "New workflow with AI",
        icon: <Sparkles />,
        group: "Create",
        keywords: ["generate", "create", "prompt"],
        href: "/workflows/new",
      },
      {
        id: "workflows",
        label: "All workflows",
        icon: <LayoutGrid />,
        group: "Navigate",
        href: "/workflows",
      },
      {
        id: "integrations",
        label: "Integrations",
        icon: <Plug />,
        group: "Navigate",
        keywords: ["connect", "gmail", "github", "slack", "mcp"],
        href: "/settings/integrations",
      },
      {
        id: "theme",
        label: "Change theme",
        icon: <Palette />,
        group: "Preferences",
        keywords: ["dark", "light", "appearance"],
        placeholder: "Choose a theme…",
        children: [
          { id: "theme-light", label: "Light", icon: <Sun /> },
          { id: "theme-dark", label: "Dark", icon: <Moon /> },
          { id: "theme-system", label: "System", icon: <Monitor /> },
        ],
      },
    ];

    if (workflows.length > 0) {
      base.splice(2, 0, {
        id: "open-workflow",
        label: "Open workflow",
        icon: <Workflow />,
        group: "Navigate",
        placeholder: "Search workflows…",
        children: workflows.map((workflow) => ({
          id: `workflow-${workflow.id}`,
          label: workflow.name,
          icon: <Workflow />,
          href: `/workflows/${workflow.id}`,
        })),
      });
    }

    return base;
  }, [workflows]);

  return (
    <ActionSearchBar
      className={cn("max-w-xs", className)}
      items={items}
      shortcut
      label="Search commands"
      placeholder="Search or jump to…"
      defaultRecent={[]}
      onSelect={(item) => {
        if (item.id.startsWith("theme-")) {
          setThemePreference(item.id.slice("theme-".length) as ThemePreference);
          return;
        }
        if (item.href) router.push(item.href);
      }}
    />
  );
}
