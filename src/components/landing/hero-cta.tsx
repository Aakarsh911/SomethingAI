"use client";

import Link from "next/link";
import SlideTextButton from "@/components/kokonutui/slide-text-button";

export function HeroCta() {
  return (
    <div className="mt-10 flex flex-col items-center gap-8 sm:flex-row sm:gap-10">
      <Link
        href="/sign-up"
        className="inline-flex h-11 min-w-48 items-center justify-center rounded-xl bg-primary px-6 text-[15px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/85"
      >
        Start building
      </Link>
      <SlideTextButton
        href="#how"
        variant="ghost"
        text="See how it works"
        hoverText="Three steps, no code"
        className="h-11 rounded-xl bg-background/60 px-6 text-[15px] tracking-tight backdrop-blur"
      />
    </div>
  );
}
