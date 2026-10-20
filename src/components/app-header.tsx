"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Sparkles } from "lucide-react";
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
    <header className="sticky top-0 z-40 shrink-0 border-b border-border/80 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-5">
        <Brand href="/workflows" />

        <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />

        <nav className="hidden items-center gap-0.5 sm:flex">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {item.label}
                {active ? (
                  <span
                    className="absolute inset-x-2.5 -bottom-[13px] h-px bg-foreground"
                    aria-hidden
                  />
                ) : null}
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
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/85"
            >
              <Sparkles className="size-3.5" />
              <span className="hidden sm:inline">New with AI</span>
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
