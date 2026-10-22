"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrambleTextPlugin, ScrollTrigger);
}

const PHRASES = [
  "Monday digest sent",
  "Follow-up labels applied",
  "Stale PR reminder",
  "Tomorrow’s agenda drafted",
];

const RIBBON = [
  "Gmail",
  "GitHub",
  "Slack",
  "Calendar",
  "Notion",
  "Linear",
  "Jira",
  "HubSpot",
];

/** Kinetic type for the overnight runs. Scroll leans the ribbon. */
export function RunNotifications() {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const title = q("[data-scramble]")[0] as HTMLElement;
      const track = q("[data-marquee]")[0] as HTMLElement;
      let phrase = 0;
      let scrollV = 0;
      let skew = 0;
      let x = 0;
      let stopped = false;

      const cycle = () => {
        if (stopped) return;
        phrase = (phrase + 1) % PHRASES.length;
        gsap.to(title, {
          duration: 1,
          scrambleText: {
            text: PHRASES[phrase],
            chars: "lowerCase",
            speed: 0.35,
          },
          onComplete: () => {
            gsap.delayedCall(1.5, cycle);
          },
        });
      };
      gsap.delayedCall(1.4, cycle);

      const trigger = ScrollTrigger.create({
        trigger: root,
        start: "top bottom",
        end: "bottom top",
        onUpdate: (self) => {
          scrollV = self.getVelocity();
        },
      });

      const tick = () => {
        scrollV *= 0.88;
        const width = track.scrollWidth / 2;
        if (!width) return;
        const dt = gsap.ticker.deltaRatio(60);
        x = gsap.utils.wrap(-width, 0, x - (1.15 + scrollV / -3500) * dt);
        skew += (gsap.utils.clamp(-7, 7, scrollV / -700) - skew) * 0.12;
        gsap.set(track, { x, skewX: skew });
      };
      gsap.ticker.add(tick);

      return () => {
        stopped = true;
        gsap.ticker.remove(tick);
        trigger.kill();
      };
    });

    return () => mm.revert();
  }, { scope: rootRef });

  const words = [...RIBBON, ...RIBBON];

  return (
    <div ref={rootRef} className="overflow-hidden">
      <p className="text-sm font-medium text-brand">Overnight</p>
      <h3
        data-scramble
        className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-balance sm:text-5xl"
      >
        Monday digest sent
      </h3>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-foreground/80 sm:text-base">
        Four runs finished. Nothing was sent.
      </p>

      <div className="relative mt-10 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent sm:w-24"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent sm:w-24"
        />
        <div data-marquee className="flex w-max items-center gap-8 py-2 sm:gap-12">
          {words.map((word, index) => (
            <span
              key={`${word}-${index}`}
              className={
                index % 2
                  ? "text-4xl font-semibold tracking-[-0.04em] text-transparent [-webkit-text-stroke:1.5px_var(--foreground)] sm:text-6xl"
                  : "text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-6xl"
              }
            >
              {word}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
