"use client";

import { useRouter } from "next/navigation";
import AttractButton from "@/components/kokonutui/attract-button";
import SlideTextButton from "@/components/kokonutui/slide-text-button";

export function HeroCta() {
  const router = useRouter();

  return (
    <div className="mt-10 flex flex-col items-center gap-8 sm:flex-row sm:gap-10">
      <AttractButton
        className="h-11 min-w-48 rounded-xl px-6 text-[15px]"
        density={1.15}
        radius={68}
        onClick={() => router.push("/sign-up")}
      >
        Start building
      </AttractButton>
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
