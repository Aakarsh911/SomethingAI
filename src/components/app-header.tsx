"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Plus } from "lucide-react";
import { Brand } from "@/components/brand";
import { CommandMenu, type CommandWorkflow } from "@/components/command-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  {
    href: "/workflows",
    label: "Workflows",
    match: (path: string) => path.startsWith("/workflows") && path !== "/workflows/new",
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    match: (path: string) => path.startsWith("/settings"),
  },
];

export function AppHeader({ workflows }: { workflows?: CommandWorkflow[] }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-border bg-background">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-5">
        <Brand href="/workflows" />

        <nav className="hidden items-center gap-1 rounded-full bg-muted p-1 sm:flex">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="hidden w-full max-w-xs md:block">
            <CommandMenu workflows={workflows} className="max-w-none" />
          </div>
          {pathname !== "/workflows/new" ? (
            <Link
              href="/workflows/new"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">New workflow</span>
            </Link>
          ) : null}
          <ThemeToggle />
          <div className="flex size-8 items-center justify-center">
            <UserButton />
          </div>
        </div>
      </div>
    </header>
  );
}
