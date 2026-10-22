"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Bot, Clock, GitPullRequest, Mail, MessageSquare, Sparkles } from "lucide-react";
import { NotificationCard } from "@/components/kokonutui/notification-stack";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  gsap.registerPlugin(DrawSVGPlugin, MotionPathPlugin, ScrollTrigger);
}

const NODES = [
  {
    id: "trigger",
    left: "3%",
    top: "36%",
    chip: "bg-g-blue text-white",
    icon: Clock,
    title: "Every Monday",
    body: "9:00 AM",
  },
  {
    id: "gmail",
    left: "28%",
    top: "6%",
    chip: "bg-[#EA4335] text-white",
    icon: Mail,
    title: "Unread mail",
    body: "Gmail",
  },
  {
    id: "github",
    left: "28%",
    top: "64%",
    chip: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
    icon: GitPullRequest,
    title: "Pull requests",
    body: "GitHub",
  },
  {
    id: "model",
    left: "53%",
    top: "36%",
    chip: "bg-g-yellow text-[#202124]",
    icon: Bot,
    title: "Five-bullet digest",
    body: "Model",
  },
  {
    id: "slack",
    left: "78%",
    top: "36%",
    chip: "bg-[#4A154B] text-white",
    icon: MessageSquare,
    title: "#eng-updates",
    body: "Slack",
  },
] as const;

const MAIN_EDGES = [
  { id: "tg", from: "trigger", to: "gmail", stroke: "var(--g-blue)" },
  { id: "th", from: "trigger", to: "github", stroke: "var(--g-blue)" },
  { id: "gm", from: "gmail", to: "model", stroke: "var(--g-green)" },
  { id: "hm", from: "github", to: "model", stroke: "var(--g-green)" },
] as const;

function iconChip(className: string, Icon: typeof Clock) {
  return (
    <span className={cn("flex size-8 items-center justify-center rounded-lg", className)}>
      <Icon className="size-4" />
    </span>
  );
}

/**
 * The sentence splits into notification cards. Connectors are measured from
 * the cards themselves, so the lines meet the boxes.
 */
export function WorkflowPreview() {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = gsap.utils.selector(root);
    const stage = () => root.querySelector<HTMLElement>("[data-stage]");

    const anchor = (id: string, side: "left" | "right") => {
      const current = stage();
      const card = root.querySelector<HTMLElement>(`[data-node='${id}']`);
      if (!current || !card) return null;
      const box = current.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      if (rect.width < 2) return null;
      return {
        x: (side === "right" ? rect.right : rect.left) - box.left,
        y: rect.top + rect.height / 2 - box.top,
      };
    };

    const shown = (id: string) => {
      const card = root.querySelector<HTMLElement>(`[data-node='${id}']`);
      return !!card && Number.parseFloat(getComputedStyle(card).opacity) > 0.35;
    };

    const drawEdge = (id: string, from: string, to: string) => {
      const path = root.querySelector<SVGPathElement>(`[data-edge='${id}']`);
      const start = anchor(from, "right");
      const end = anchor(to, "left");
      if (!path || !start || !end) return;
      const mid = (start.x + end.x) / 2;
      path.setAttribute(
        "d",
        `M ${start.x} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${end.x} ${end.y}`,
      );
    };

    const placeWires = (includeSlack: boolean) => {
      const current = stage();
      const svg = root.querySelector("svg");
      if (!current || !svg) return;
      const box = current.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      for (const edge of MAIN_EDGES) {
        if (shown(edge.from) && shown(edge.to)) drawEdge(edge.id, edge.from, edge.to);
      }
      if (includeSlack && shown("model") && shown("slack")) {
        drawEdge("ms", "model", "slack");
      }
    };

    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set(q("[data-sentence]"), { autoAlpha: 0 });
      gsap.set(q("[data-caption='sentence']"), { autoAlpha: 0 });
      gsap.set(q("[data-caption='edit']"), { autoAlpha: 1 });
      for (const node of NODES) {
        gsap.set(q(`[data-node='${node.id}']`), {
          left: node.left,
          top: node.top,
          xPercent: 0,
          yPercent: 0,
          autoAlpha: 1,
        });
      }
      placeWires(true);
      gsap.set(q("[data-edge]"), { drawSVG: "100%", autoAlpha: 1 });
    });

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.set(q("[data-node]"), {
        left: "50%",
        top: "46%",
        xPercent: -50,
        yPercent: -50,
        autoAlpha: 0,
      });
      gsap.set(q("[data-edge]"), { drawSVG: 0, autoAlpha: 0 });

      const tl = gsap.timeline({
        repeat: -1,
        yoyo: true,
        repeatDelay: 0.7,
        scrollTrigger: {
          trigger: root,
          start: "top 85%",
          toggleActions: "play pause resume pause",
        },
      });

      tl.addLabel("split", 0.8);

      tl.to(q("[data-sentence]"), { autoAlpha: 0, duration: 0.3 }, "split");

      for (const node of NODES) {
        if (node.id === "slack") continue;
        tl.to(
          q(`[data-node='${node.id}']`),
          {
            left: node.left,
            top: node.top,
            xPercent: 0,
            yPercent: 0,
            autoAlpha: 1,
            duration: 1.05,
            ease: "expo.inOut",
          },
          "split",
        );
      }

      tl.addLabel("wires", "split+=1.08");
      tl.call(() => placeWires(false), undefined, "wires");
      tl.set(q("[data-edge='tg'], [data-edge='th'], [data-edge='gm'], [data-edge='hm']"), {
        autoAlpha: 1,
      }, "wires");
      tl.fromTo(
        q("[data-edge='tg'], [data-edge='th'], [data-edge='gm'], [data-edge='hm']"),
        { drawSVG: "50% 50%" },
        { drawSVG: "0% 100%", duration: 0.6, stagger: 0.07, ease: "power2.inOut" },
        "wires",
      );

      const ride = (pulse: "a" | "b", edge: string, at: string, duration = 0.6) => {
        tl.to(
          q(`[data-pulse='${pulse}']`),
          {
            motionPath: {
              path: q(`[data-edge='${edge}']`)[0],
              align: q(`[data-edge='${edge}']`)[0],
              alignOrigin: [0.5, 0.5],
            },
            duration,
            ease: "power1.inOut",
          },
          at,
        );
      };

      tl.addLabel("run", "wires+=0.5");
      tl.to(q("[data-pulse]"), { autoAlpha: 1, duration: 0.12 }, "run");
      ride("a", "tg", "run");
      ride("b", "th", "run");
      ride("a", "gm", "run+=0.6");
      ride("b", "hm", "run+=0.6");

      const slack = NODES.find((node) => node.id === "slack")!;
      const model = NODES.find((node) => node.id === "model")!;
      tl.addLabel("edit", "run+=1.3");
      tl.to(q("[data-caption='sentence']"), { autoAlpha: 0, duration: 0.28 }, "edit");
      tl.to(q("[data-caption='edit']"), { autoAlpha: 1, duration: 0.28 }, "edit");
      tl.to(q("[data-pulse='b']"), { autoAlpha: 0, duration: 0.2 }, "edit");
      tl.fromTo(
        q("[data-node='slack']"),
        { left: model.left, top: model.top, xPercent: 0, yPercent: 0, autoAlpha: 0 },
        {
          left: slack.left,
          top: slack.top,
          autoAlpha: 1,
          duration: 0.9,
          ease: "expo.inOut",
        },
        "edit",
      );
      tl.addLabel("slackWire", "edit+=0.92");
      tl.call(() => drawEdge("ms", "model", "slack"), undefined, "slackWire");
      tl.set(q("[data-edge='ms']"), { autoAlpha: 1 }, "slackWire");
      tl.fromTo(
        q("[data-edge='ms']"),
        { drawSVG: "50% 50%" },
        { drawSVG: "0% 100%", duration: 0.45, ease: "power2.out" },
        "slackWire",
      );
      ride("a", "ms", "slackWire+=0.15", 0.48);
      tl.set({}, {}, "slackWire+=0.7");

      const observer = new ResizeObserver(() => placeWires(shown("slack")));
      const current = stage();
      if (current) observer.observe(current);
      return () => observer.disconnect();
    });

    return () => mm.revert();
  }, { scope: rootRef });

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)] dark:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-foreground/10" />
          <span className="size-2.5 rounded-full bg-foreground/10" />
          <span className="size-2.5 rounded-full bg-foreground/10" />
        </span>
        <span className="ml-2 text-xs font-medium text-muted-foreground">Monday engineering digest</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Scheduled
        </span>
      </div>

      <p className="sr-only">
        A sentence becomes a workflow. Every Monday, unread mail and open pull
        requests become a five-bullet digest, then the digest is posted to Slack.
      </p>

      <div
        aria-hidden
        data-stage
        className="relative h-[26rem] overflow-hidden bg-canvas sm:h-[30rem]"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 42% 58% at 10% 48%, color-mix(in srgb, var(--g-blue) 18%, transparent), transparent 70%), radial-gradient(ellipse 36% 52% at 90% 16%, color-mix(in srgb, var(--g-green) 14%, transparent), transparent 68%), radial-gradient(ellipse 34% 48% at 74% 92%, color-mix(in srgb, var(--g-yellow) 16%, transparent), transparent 70%)",
          }}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {[...MAIN_EDGES, { id: "ms", from: "model", to: "slack", stroke: "var(--g-red)" }].map(
            (edge) => (
              <path
                key={edge.id}
                data-edge={edge.id}
                d="M 0 0 C 0 0, 0 0, 0 0"
                fill="none"
                stroke={edge.stroke}
                strokeWidth={2}
                strokeLinecap="round"
                className="opacity-0"
              />
            ),
          )}
          <g data-pulse="a" className="opacity-0">
            <circle r="7" fill="var(--g-blue)" opacity="0.22" />
            <circle r="3.5" fill="var(--g-blue)" />
          </g>
          <g data-pulse="b" className="opacity-0">
            <circle r="7" fill="var(--g-green)" opacity="0.22" />
            <circle r="3.5" fill="var(--g-green)" />
          </g>
        </svg>

        <div
          data-sentence
          className="absolute top-[46%] left-1/2 w-[min(34rem,88%)] -translate-x-1/2 -translate-y-1/2"
        >
          <NotificationCard
            item={{
              title: "Every Monday, summarise unread mail and open pull requests.",
              body: "Monday engineering digest",
              icon: iconChip("bg-g-blue text-white", Sparkles),
            }}
          />
        </div>

        {NODES.map((node) => (
          <div
            key={node.id}
            data-node={node.id}
            {...(node.id === "slack" ? { "data-slack-label": "" } : {})}
            className="absolute w-[17%] min-w-0 opacity-0"
            style={{ left: "50%", top: "46%" }}
          >
            <NotificationCard
              item={{
                title: node.title,
                body: node.body,
                icon: iconChip(node.chip, node.icon),
              }}
            />
          </div>
        ))}
      </div>

      <div className="relative flex h-12 items-center gap-3 border-t border-border px-4">
        <Sparkles className="size-4 shrink-0 text-brand" />
        <p data-caption="sentence" className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Every Monday, summarise unread mail and open pull requests.
        </p>
        <p
          data-caption="edit"
          className="invisible absolute inset-y-0 right-4 left-11 flex items-center truncate text-sm text-muted-foreground"
        >
          “Also post the digest to #eng-updates on Slack”
        </p>
      </div>
    </div>
  );
}
