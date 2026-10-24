"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import CurrencyTransfer from "@/components/kokonutui/currency-transfer";
import TopoBackground from "@/components/kokonutui/topo-background";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const LOGOS = {
  gmail: "https://logos.composio.dev/api/gmail",
  github: "https://logos.composio.dev/api/github",
  slack: "https://logos.composio.dev/api/slack",
  calendar: "https://logos.composio.dev/api/googlecalendar",
} as const;

function ToolLogo({
  name,
  src,
  className = "size-5",
}: {
  name: string;
  src: string;
  className?: string;
}) {
  return (
    // External toolkit logos come from Composio; same source as integrations.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" title={name} className={`${className} object-contain`} />
  );
}

const SHIFTS = [
  {
    time: "9:00 PM",
    title: "Monday digest",
    name: "Slack",
    destination: "#eng-updates",
    initials: "S",
    logo: LOGOS.slack,
    metric: "5",
    unit: "bullets",
    asked: "Unread mail and open PRs, five bullets, before standup.",
    txnId: "run_digest_mon",
    color: "var(--g-blue)",
    steps: [
      { title: "Read the inbox", detail: "23 unread threads", logo: LOGOS.gmail, tool: "Gmail" },
      { title: "Check GitHub", detail: "6 open pull requests", logo: LOGOS.github, tool: "GitHub" },
      { title: "Write the digest", detail: "5 bullets", logo: undefined, tool: undefined },
      { title: "Post to Slack", detail: "#eng-updates", logo: LOGOS.slack, tool: "Slack" },
    ],
  },
  {
    time: "2:15 AM",
    title: "Quiet pull requests",
    name: "GitHub",
    destination: "reviewers",
    initials: "GH",
    logo: LOGOS.github,
    metric: "3",
    unit: "nudges",
    asked: "If a PR has been quiet for three days, ping the reviewers.",
    txnId: "run_stale_prs",
    color: "var(--g-yellow)",
    steps: [
      { title: "Find stale PRs", detail: "3 quiet for 3 days", logo: LOGOS.github, tool: "GitHub" },
      { title: "Pick reviewers", detail: "Alex, Priya, Dan", logo: LOGOS.github, tool: "GitHub" },
      { title: "Leave a comment", detail: "Still needs a look?", logo: LOGOS.github, tool: "GitHub" },
      { title: "Mark as nudged", detail: "won't ping again tonight", logo: LOGOS.github, tool: "GitHub" },
    ],
  },
  {
    time: "5:40 AM",
    title: "Tomorrow’s agenda",
    name: "Calendar",
    destination: "tomorrow",
    initials: "C",
    logo: LOGOS.calendar,
    metric: "2",
    unit: "conflicts",
    asked: "Put tomorrow on one page and flag anything that overlaps.",
    txnId: "run_agenda_am",
    color: "var(--g-green)",
    steps: [
      { title: "Load tomorrow", detail: "5 meetings", logo: LOGOS.calendar, tool: "Calendar" },
      { title: "Find overlaps", detail: "2 conflicts", logo: LOGOS.calendar, tool: "Calendar" },
      { title: "Draft one page", detail: "rooms, guests, notes", logo: undefined, tool: undefined },
      { title: "Ready at 5:40 AM", detail: "waiting on your desk", logo: LOGOS.calendar, tool: "Calendar" },
    ],
  },
  {
    time: "6:00 AM",
    title: "Follow-up labels",
    name: "Gmail",
    destination: "Follow up",
    initials: "G",
    logo: LOGOS.gmail,
    metric: "4",
    unit: "threads",
    asked: "Anything from my manager still unanswered — label it Follow up.",
    txnId: "run_follow_up",
    color: "var(--g-red)",
    steps: [
      { title: "Search the inbox", detail: "from:manager", logo: LOGOS.gmail, tool: "Gmail" },
      { title: "Still unanswered", detail: "4 threads", logo: LOGOS.gmail, tool: "Gmail" },
      { title: "Apply the label", detail: "Follow up", logo: LOGOS.gmail, tool: "Gmail" },
      { title: "Leave the rest", detail: "already replied", logo: LOGOS.gmail, tool: "Gmail" },
    ],
  },
] as const;

/** Pinned night index, centered. Cards swap one by one on the right. */
export function RunNotifications() {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: reduce), (max-width: 1023px)", () => {
      gsap.set(q("[data-shift]"), { autoAlpha: 1, y: 0, clearProps: "transform" });
      gsap.set(q("[data-index]"), { autoAlpha: 1 });
    });

    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const stage = q("[data-stage]")[0] as HTMLElement;
      const cards = q("[data-shift]");
      const marks = q("[data-index]");
      if (!stage || cards.length === 0) return;

      gsap.set(cards, { autoAlpha: 0, y: 48 });
      gsap.set(cards[0], { autoAlpha: 1, y: 0 });
      gsap.set(marks, { autoAlpha: 0.38 });
      gsap.set(marks[0], { autoAlpha: 1 });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: stage,
          start: "top 72px",
          end: () => `+=${Math.round(window.innerHeight * SHIFTS.length * 0.85)}`,
          pin: true,
          scrub: 0.7,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      SHIFTS.forEach((_, index) => {
        tl.to({}, { duration: 0.55 });
        if (index === SHIFTS.length - 1) return;
        tl.to(cards[index], { autoAlpha: 0, y: -32, duration: 0.45, ease: "power2.inOut" });
        tl.to(marks[index], { autoAlpha: 0.38, duration: 0.25 }, "<");
        tl.fromTo(
          cards[index + 1],
          { autoAlpha: 0, y: 48 },
          { autoAlpha: 1, y: 0, duration: 0.45, ease: "power2.out" },
          "<0.12",
        );
        tl.to(marks[index + 1], { autoAlpha: 1, duration: 0.25 }, "<");
      });

      return () => {
        tl.scrollTrigger?.kill();
        tl.kill();
      };
    });

    return () => mm.revert();
  }, { scope: rootRef });

  return (
    <div ref={rootRef}>
      <div
        data-stage
        className="relative isolate overflow-hidden rounded-[1.75rem] px-5 py-10 sm:px-8 sm:py-12 lg:h-[calc(100svh-72px)] lg:px-10"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute inset-0 bg-canvas"
            style={{
              backgroundImage: [
                "radial-gradient(ellipse 70% 55% at 8% 42%, color-mix(in srgb, var(--g-blue) 11%, transparent), transparent 68%)",
                "radial-gradient(ellipse 50% 40% at 92% 78%, color-mix(in srgb, var(--g-yellow) 9%, transparent), transparent 70%)",
              ].join(", "),
            }}
          />
          <TopoBackground
            className="absolute inset-0 min-h-0 bg-transparent opacity-[0.22] dark:opacity-[0.18]"
            interval={0.1}
            speed={0.12}
            interactive={false}
            labels={false}
            seed={11}
          >
            {null}
          </TopoBackground>
        </div>

        <div className="grid h-full gap-8 lg:grid-cols-[minmax(0,18.5rem)_minmax(0,1fr)] lg:items-center lg:gap-12">
          <div>
            <p className="text-sm font-medium text-brand">Overnight</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
              The night shift.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-foreground/80">
              Four sentences people hand off before they leave. In the morning the work is already there.
            </p>

            <ol className="mt-8 hidden space-y-1 lg:block">
              {SHIFTS.map((shift, index) => (
                <li
                  key={shift.time}
                  data-index
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-black/5">
                    <ToolLogo name={shift.name} src={shift.logo} className="size-3.5" />
                  </span>
                  <span className="w-16 font-mono text-xs tabular-nums text-muted-foreground">
                    {shift.time}
                  </span>
                  <span className="text-sm font-medium">{shift.title}</span>
                  <span className="sr-only">Job {index + 1}</span>
                </li>
              ))}
            </ol>
          </div>

          <ol className="grid justify-items-stretch gap-6 overflow-hidden sm:justify-items-end lg:gap-0">
            {SHIFTS.map((shift) => (
              <li key={shift.time} className="w-full max-w-md lg:col-start-1 lg:row-start-1">
                <div data-shift>
                  <CurrencyTransfer
                    className="mx-0 ml-auto w-full max-w-none"
                    run={{
                      name: shift.name,
                      destination: shift.destination,
                      initials: shift.initials,
                      icon: <ToolLogo name={shift.name} src={shift.logo} />,
                      accent: shift.color,
                      metric: shift.metric,
                      unit: shift.unit,
                      asked: shift.asked,
                      steps: shift.steps.map((step) => ({
                        title: step.title,
                        detail: step.detail,
                        icon: step.logo ? (
                          <ToolLogo
                            name={step.tool ?? shift.name}
                            src={step.logo}
                            className="size-4"
                          />
                        ) : undefined,
                      })),
                    }}
                    status="completed"
                    timestamp={shift.time}
                    txnId={shift.txnId}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
