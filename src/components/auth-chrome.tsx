"use client";

import BackgroundPaths from "@/components/kokonutui/background-paths";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function AuthChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] bg-background">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
        <Brand />
        <ThemeToggle />
      </header>
      <BackgroundPaths
        className="min-h-[100dvh] bg-transparent pt-16 text-foreground dark:bg-transparent"
        count={28}
        speed={0.45}
      >
        <div className="relative flex w-full justify-center px-6 py-10">{children}</div>
      </BackgroundPaths>
    </div>
  );
}
