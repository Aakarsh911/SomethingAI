"use client";

import { useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const TEAL = "oklch(0.85 0.14 170)";
const VIOLET = "oklch(0.8 0.14 295)";
const AMBER = "oklch(0.85 0.14 80)";

const KIND = {
  trigger: ["Trigger", TEAL],
  schedule: ["Schedule", TEAL],
  ai: ["Model call", VIOLET],
  logic: ["Logic", "oklch(0.74 0.17 20)"],
  approval: ["Approval", AMBER],
  action: ["Action", "oklch(0.76 0.16 250)"],
} as const;

type Kind = keyof typeof KIND;

const SCENE = {
  segs: [
    { t: "Every Monday at 9am", k: 0 },
    { t: ", pull " },
    { t: "failed Stripe payments", k: 1 },
    { t: ", " },
    { t: "draft a polite email", k: 2 },
    { t: " for each, and " },
    { t: "wait for my OK", k: 3 },
    { t: "." },
  ],
  nodes: [
    { k: "schedule" as Kind, t: "Mon · 09:00", x: 14, y: 30 },
    { k: "action" as Kind, t: "Stripe · list failed charges", x: 38, y: 68 },
    { k: "ai" as Kind, t: "Draft email per customer", x: 62, y: 30 },
    { k: "approval" as Kind, t: "Wait for your OK", x: 86, y: 68 },
  ],
  edges: [
    [0, 1],
    [1, 2],
    [2, 3],
  ] as [number, number][],
};

const TYPE_LEN = SCENE.segs.reduce((n, seg) => n + seg.t.length, 0);
const NODE_COUNT = SCENE.nodes.length;
const CARD_H = 540;

const mix = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${percent}%, transparent)`;

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function span(p: number, a: number, b: number) {
  if (b <= a) return p >= a ? 1 : 0;
  return clamp01((p - a) / (b - a));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Compile window: scroll expands it fullscreen and scrubs the Monday prompt onto a graph. */
export function WorkflowPreview() {
  const rootRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [staticMode, setStaticMode] = useState(false);
  const [vw, setVw] = useState(1200);
  const [vh, setVh] = useState(800);

  useGSAP(
    () => {
      const pin = pinRef.current;
      if (!pin) return;

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        setStaticMode(true);
        setProgress(1);
        return;
      }

      setStaticMode(false);
      setVw(window.innerWidth);
      setVh(window.innerHeight);

      const st = ScrollTrigger.create({
        trigger: pin,
        start: "top top",
        end: () => `+=${Math.round(window.innerHeight * 1.85)}`,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      });

      const sync = () => {
        const spanY = st.end - st.start;
        const y = window.scrollY || document.documentElement.scrollTop;
        const next = spanY <= 0 ? 0 : clamp01((y - st.start) / spanY);
        setProgress((prev) => (Math.abs(prev - next) < 0.0008 ? prev : next));
      };
      const onResize = () => {
        setVw(window.innerWidth);
        setVh(window.innerHeight);
        ScrollTrigger.refresh();
        sync();
      };

      sync();
      gsap.ticker.add(sync);
      window.addEventListener("resize", onResize);

      return () => {
        gsap.ticker.remove(sync);
        window.removeEventListener("resize", onResize);
        st.kill();
      };
    },
    { scope: rootRef, dependencies: [] },
  );

  const expand = staticMode ? 0 : span(progress, 0, 0.86);
  const typed = staticMode ? TYPE_LEN : Math.round(span(progress, 0.06, 0.48) * TYPE_LEN);
  const mapped = staticMode
    ? NODE_COUNT
    : Math.round(span(progress, 0.42, 0.84) * NODE_COUNT);
  const tilt = staticMode ? 14 : lerp(14, 0, expand);
  const startW = Math.min(1152, Math.max(320, vw - 48));
  const stageW = lerp(startW, vw, expand);
  const stageH = lerp(CARD_H, vh, expand);
  const phase: "type" | "map" | "run" =
    typed < TYPE_LEN ? "type" : mapped < NODE_COUNT ? "map" : "run";

  const visible = useMemo(() => {
    const starts = SCENE.segs.map((_, index) =>
      SCENE.segs.slice(0, index).reduce((n, seg) => n + seg.t.length, 0),
    );
    const segs = SCENE.segs.map((seg, index) => {
      const text = seg.t.slice(0, Math.max(0, typed - starts[index]));
      const on = seg.k != null && mapped > seg.k;
      const color = seg.k != null ? KIND[SCENE.nodes[seg.k].k][1] : "#eef0f3";
      return {
        text,
        on,
        num: seg.k != null ? seg.k + 1 : "",
        color: on ? color : seg.k != null && phase !== "type" ? "#eef0f3" : "#c9ced6",
        bg: on ? mix(color, 14) : "transparent",
        ring: on ? `inset 0 -2px 0 ${color}` : "none",
        pad: on ? "1px 4px" : "1px 0",
      };
    });

    const nodes = SCENE.nodes.map((node, index) => {
      const on = mapped > index;
      const color = KIND[node.k][1];
      const hot = on && mapped === index + 1 && phase === "map";
      return {
        ...node,
        kindLabel: KIND[node.k][0],
        color,
        num: index + 1,
        o: on ? 1 : 0,
        s: on ? (hot ? 1.05 : 1) : 0.92,
        border: on ? mix(color, hot ? 90 : 40) : "rgba(255,255,255,.08)",
        glow: hot
          ? `0 0 0 5px ${mix(color, 14)}, 0 20px 50px -12px ${mix(color, 60)}`
          : phase === "run"
            ? `0 0 0 1px ${mix(color, 25)}, 0 16px 40px -18px ${mix(color, 50)}`
            : "0 14px 30px -14px rgba(0,0,0,.9)",
      };
    });

    const edges = SCENE.edges.map(([from, to]) => {
      const start = SCENE.nodes[from];
      const end = SCENE.nodes[to];
      const x1 = start.x + 9;
      const x2 = end.x - 9;
      const mid = (x1 + x2) / 2;
      const on = mapped > from && mapped > to;
      return {
        d: `M ${x1} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${x2} ${end.y}`,
        off: on ? 0 : 1,
        flow: phase === "run" ? 1 : 0,
      };
    });

    const status = (
      {
        type: "listening",
        map: `resolving ${Math.min(mapped + 1, NODE_COUNT)}/${NODE_COUNT}`,
        run: "live · run ok · 412ms",
      } as const
    )[phase];
    const statusColor = phase === "run" ? TEAL : phase === "map" ? VIOLET : "#9aa1ac";

    return { segs, nodes, edges, status, statusColor, typing: phase === "type" };
  }, [typed, mapped, phase]);

  return (
    <div ref={rootRef} className="-mt-28">
      <div
        ref={pinRef}
        className="relative z-10 w-full"
        style={{ height: staticMode ? undefined : CARD_H }}
      >
        <div
          className="flex h-full w-full items-start justify-center"
          style={{ perspective: 1400 }}
        >
          <div
            className={`relative flex w-full flex-col overflow-hidden border border-white/10 bg-gradient-to-b from-[#13161b] to-[#0d0f12] [transform-style:preserve-3d] ${staticMode ? "max-w-6xl rounded-[20px]" : ""}`}
            style={{
              width: staticMode ? undefined : stageW,
              maxWidth: staticMode ? undefined : "100%",
              height: staticMode ? undefined : stageH,
              borderRadius: staticMode ? 20 : lerp(20, 0, expand),
              transform: `rotateX(${tilt}deg)`,
              transformOrigin: "50% 0%",
              boxShadow:
                expand > 0.92
                  ? "none"
                  : "0 60px 140px -40px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.02) inset",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[3]"
              style={{
                background:
                  "radial-gradient(420px circle at 50% 0%, rgba(255,255,255,.06), transparent 60%)",
              }}
            />

            <div className="flex shrink-0 items-center gap-2 border-b border-white/[.07] px-[18px] py-[13px]">
              <span className="size-2.5 rounded-full bg-[#2a2e35]" />
              <span className="size-2.5 rounded-full bg-[#2a2e35]" />
              <span className="size-2.5 rounded-full bg-[#2a2e35]" />
              <span className="ml-2.5 font-mono text-xs text-[#7d848f]">somethingai / compile</span>
              <span
                className="ml-auto flex items-center gap-1.5 font-mono text-xs"
                style={{ color: visible.statusColor }}
              >
                <span
                  className="size-1.5 rounded-full [animation:compile-dot_1.4s_infinite]"
                  style={{ background: visible.statusColor }}
                />
                {visible.status}
              </span>
            </div>

            <div className="min-h-[118px] shrink-0 border-b border-white/[.07] px-7 pt-[26px] pb-[22px] text-left">
              <div className="mb-2.5 font-mono text-[11px] font-medium tracking-[0.08em] text-[#7d848f]">
                PROMPT
              </div>
              <p className="text-[clamp(18px,2.1vw,25px)] leading-[1.5] font-medium tracking-[-0.015em] text-[#eef0f3]">
                {visible.segs.map((seg, index) => (
                  <span
                    key={index}
                    className="relative rounded-md"
                    style={{
                      padding: seg.pad,
                      background: seg.bg,
                      color: seg.color,
                      boxShadow: seg.ring,
                    }}
                  >
                    {seg.text}
                    {seg.on ? (
                      <sup
                        className="ml-1 font-mono text-[10px] font-semibold"
                        style={{ color: seg.color }}
                      >
                        {seg.num}
                      </sup>
                    ) : null}
                  </span>
                ))}
                {visible.typing ? (
                  <span className="ml-0.5 inline-block h-[1.05em] w-0.5 align-[-3px] bg-[oklch(0.85_0.14_170)] [animation:compile-blink_1s_steps(1)_infinite]" />
                ) : null}
              </p>
            </div>

            <div className="relative min-h-[clamp(300px,34vw,380px)] flex-1 bg-size-[20px_20px] [background-image:radial-gradient(rgba(255,255,255,.07)_1px,transparent_1px)]">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                {visible.edges.map((edge) => (
                  <g key={edge.d}>
                    <path
                      d={edge.d}
                      fill="none"
                      stroke="rgba(255,255,255,.22)"
                      pathLength={1}
                      style={{
                        strokeWidth: 1.3,
                        vectorEffect: "non-scaling-stroke",
                        strokeDasharray: 1,
                        strokeDashoffset: edge.off,
                        transition: "stroke-dashoffset .15s linear",
                      }}
                    />
                    <path
                      d={edge.d}
                      fill="none"
                      stroke={TEAL}
                      pathLength={1}
                      className="[animation:compile-flow_1.4s_linear_infinite]"
                      style={{
                        strokeWidth: 3,
                        strokeLinecap: "round",
                        vectorEffect: "non-scaling-stroke",
                        strokeDasharray: "0.02 0.18",
                        opacity: edge.flow,
                        transition: "opacity .2s",
                      }}
                    />
                  </g>
                ))}
              </svg>

              {visible.nodes.map((node) => (
                <div
                  key={node.num}
                  className="absolute w-[min(220px,22%)] rounded-xl px-[13px] py-[11px] text-left"
                  style={{
                    left: `${node.x}%`,
                    top: `${node.y}%`,
                    transform: `translate(-50%, -50%) scale(${node.s})`,
                    opacity: node.o,
                    background: "#15181d",
                    border: `1px solid ${node.border}`,
                    boxShadow: node.glow,
                    transition: "opacity .18s linear, transform .18s linear, filter .18s linear",
                  }}
                >
                  <div
                    className="flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.06em] uppercase"
                    style={{ color: node.color }}
                  >
                    <span className="size-1.5 rounded-[2px]" style={{ background: node.color }} />
                    {node.kindLabel}
                    <span className="ml-auto text-[#7d848f]">{node.num}</span>
                  </div>
                  <div className="mt-1.5 text-[13.5px] leading-[1.3] font-medium text-[#eef0f3]">
                    {node.t}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
