"use client";

import SlideTextButton from "@/components/kokonutui/slide-text-button";
import FlowField from "@/components/kokonutui/flow-field";
import { LogoMark } from "@/components/brand";

export function ClosingCta() {
  return (
    <section className="mx-auto mt-28 mb-24 max-w-6xl px-6">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-border bg-canvas">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" />
          <div className="absolute -right-10 bottom-0 h-56 w-56 rounded-full bg-live/15 blur-3xl" />
        </div>
        <FlowField
          className="text-brand/45 dark:text-brand/35"
          density={0.55}
          speed={0.55}
        />
        <div className="relative z-10 px-8 py-20 text-center sm:px-16">
          <div className="glass mx-auto max-w-lg rounded-3xl px-8 py-10">
            <LogoMark className="mx-auto size-9" />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
              What would you stop doing by hand?
            </h2>
            <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Connect an account and describe it. Your first workflow takes about
              a minute.
            </p>
            <div className="mt-8 flex justify-center">
              <SlideTextButton
                href="/sign-up"
                text="Get started free"
                hoverText="Takes a minute"
                className="h-11 rounded-xl px-6 text-[15px] tracking-tight"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
