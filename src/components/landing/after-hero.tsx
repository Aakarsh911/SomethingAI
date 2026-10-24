"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const SPECS = [
  {
    title: "800+ tools through MCP",
    body: "Connect with OAuth or an API key. Bring your own server if the catalog is missing one.",
    bar: "bg-g-blue",
  },
  {
    title: "Edit by asking",
    body: "“Also post it to Slack.” That compiles into a new version of the graph, not a silent rewrite of the last prompt.",
    bar: "bg-g-green",
  },
  {
    title: "Safe test runs",
    body: "Walk every step without sending mail, opening a ticket, or calling a single tool.",
    bar: "bg-g-yellow",
  },
  {
    title: "Version history",
    body: "Every save is a revision. Restore any of them if an edit goes the wrong way.",
    bar: "bg-g-red",
  },
  {
    title: "Encrypted credentials",
    body: "Tokens are sealed with AES-256-GCM at rest and refreshed for you. Nothing is shared between accounts.",
    bar: "bg-g-blue",
  },
];

/** The stepped trust list under the how-it-works section. */
export function ReadableAutomation() {
  const reduce = useReducedMotion() ?? false;

  return (
    <section id="features" className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-6">
      <h2 className="max-w-md text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
        Automation you can actually read.
      </h2>
      <ol className="mt-14">
        {SPECS.map((spec, index) => (
          <motion.li
            key={spec.title}
            className={cn(
              "border-t border-border py-8",
              index === 1 && "lg:ml-[6%]",
              index === 2 && "lg:ml-[12%]",
              index === 3 && "lg:ml-[18%]",
              index === 4 && "lg:ml-[24%]",
            )}
            initial={reduce ? false : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12% 0px" }}
            transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="flex gap-4">
              <span className={cn("mt-1 h-10 w-1 shrink-0 rounded-full", spec.bar)} aria-hidden />
              <div>
                <h3 className="text-lg font-semibold tracking-tight">{spec.title}</h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/80">
                  {spec.body}
                </p>
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}
