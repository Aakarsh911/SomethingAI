"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

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

type Scene = {
  segs: { t: string; k?: number }[];
  nodes: { k: Kind; t: string; x: number; y: number }[];
  edges: [number, number][];
};

const SCENES: Scene[] = [
  {
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
      { k: "schedule", t: "Mon · 09:00", x: 14, y: 30 },
      { k: "action", t: "Stripe · list failed charges", x: 38, y: 68 },
      { k: "ai", t: "Draft email per customer", x: 62, y: 30 },
      { k: "approval", t: "Wait for your OK", x: 86, y: 68 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  },
  {
    segs: [
      { t: "When a PR merges to main", k: 0 },
      { t: ", " },
      { t: "tag a release", k: 1 },
      { t: ", " },
      { t: "update the changelog", k: 2 },
      { t: ", then " },
      { t: "tell #eng on Slack", k: 3 },
      { t: "." },
    ],
    nodes: [
      { k: "trigger", t: "GitHub · PR merged", x: 14, y: 50 },
      { k: "action", t: "Git · tag vX.Y.Z", x: 48, y: 26 },
      { k: "action", t: "Bump CHANGELOG.md", x: 48, y: 74 },
      { k: "action", t: "Slack · post to #eng", x: 85, y: 50 },
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ],
  },
  {
    segs: [
      { t: "If Sentry sees the same error", k: 0 },
      { t: " " },
      { t: "50 times an hour", k: 1 },
      { t: ", " },
      { t: "open a Linear ticket", k: 2 },
      { t: " and " },
      { t: "page on-call", k: 3 },
      { t: "." },
    ],
    nodes: [
      { k: "trigger", t: "Sentry · error event", x: 13, y: 50 },
      { k: "logic", t: "count > 50 / 1h", x: 42, y: 50 },
      { k: "action", t: "Linear · open ticket", x: 80, y: 26 },
      { k: "ai", t: "Summarise + page on-call", x: 80, y: 74 },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
    ],
  },
];

type Phase = "type" | "map" | "run" | "out";

const mix = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${percent}%, transparent)`;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Compile window from the reference hero: type a sentence, map it onto a graph. */
export function WorkflowPreview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState(0);
  const [typed, setTyped] = useState(() =>
    prefersReducedMotion() ? SCENES[0].segs.reduce((n, seg) => n + seg.t.length, 0) : 0,
  );
  const [mapped, setMapped] = useState(() =>
    prefersReducedMotion() ? SCENES[0].nodes.length : 0,
  );
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? "run" : "type"));

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let interval = 0;
    const timeouts: number[] = [];
    const later = (fn: () => void, ms: number) => {
      timeouts.push(window.setTimeout(fn, ms));
    };

    const play = (index: number) => {
      const current = SCENES[index];
      const length = current.segs.reduce((n, seg) => n + seg.t.length, 0);
      const tokens = current.nodes.length;
      setScene(index);
      setTyped(0);
      setMapped(0);
      setPhase("type");

      let cursor = 0;
      window.clearInterval(interval);
      interval = window.setInterval(() => {
        cursor += 1 + (Math.random() < 0.35 ? 1 : 0);
        setTyped(Math.min(cursor, length));
        if (cursor < length) return;
        window.clearInterval(interval);
        setPhase("map");
        for (let token = 1; token <= tokens; token += 1) {
          later(() => setMapped(token), 250 + token * 480);
        }
        later(() => setPhase("run"), 450 + tokens * 480 + 500);
        later(() => setPhase("out"), 450 + tokens * 480 + 4200);
        later(() => play((index + 1) % SCENES.length), 450 + tokens * 480 + 4900);
      }, 30);
    };

    later(() => play(0), 0);
    return () => {
      window.clearInterval(interval);
      for (const id of timeouts) window.clearTimeout(id);
    };
  }, []);

  const current = SCENES[scene];
  const visible = useMemo(() => {
    const starts = current.segs.map((_, index) =>
      current.segs.slice(0, index).reduce((n, seg) => n + seg.t.length, 0),
    );
    const segs = current.segs.map((seg, index) => {
      const text = seg.t.slice(0, Math.max(0, typed - starts[index]));
      const on = seg.k != null && mapped > seg.k;
      const color = seg.k != null ? KIND[current.nodes[seg.k].k][1] : "#eef0f3";
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

    const nodes = current.nodes.map((node, index) => {
      const on = mapped > index;
      const color = KIND[node.k][1];
      const hot = on && mapped === index + 1 && phase === "map";
      return {
        ...node,
        kindLabel: KIND[node.k][0],
        color,
        num: index + 1,
        o: on ? 1 : 0,
        s: on ? (hot ? 1.06 : 1) : 0.8,
        b: on ? 0 : 8,
        z: on ? 30 : -60,
        border: on ? mix(color, hot ? 90 : 40) : "rgba(255,255,255,.08)",
        glow: hot
          ? `0 0 0 5px ${mix(color, 14)}, 0 20px 50px -12px ${mix(color, 60)}`
          : phase === "run"
            ? `0 0 0 1px ${mix(color, 25)}, 0 16px 40px -18px ${mix(color, 50)}`
            : "0 14px 30px -14px rgba(0,0,0,.9)",
      };
    });

    const edges = current.edges.map(([from, to]) => {
      const start = current.nodes[from];
      const end = current.nodes[to];
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
        map: `resolving ${Math.min(mapped + 1, current.nodes.length)}/${current.nodes.length}`,
        run: "live · run ok · 412ms",
        out: "deployed",
      } as const
    )[phase];
    const statusColor = phase === "run" || phase === "out" ? TEAL : phase === "map" ? VIOLET : "#9aa1ac";

    return { segs, nodes, edges, status, statusColor, fade: phase === "out" ? 0 : 1, typing: phase === "type" };
  }, [current, typed, mapped, phase]);

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const spot = spotRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    const nx = (event.clientX - box.left) / box.width - 0.5;
    const ny = (event.clientY - box.top) / box.height - 0.5;
    stage.style.transform = `rotateX(${8 - ny * 10}deg) rotateY(${nx * 14}deg)`;
    if (spot) {
      spot.style.background = `radial-gradient(460px circle at ${(nx + 0.5) * 100}% ${(ny + 0.5) * 100}%, rgba(255,255,255,.07), transparent 60%)`;
    }
  };

  const onLeave = () => {
    if (stageRef.current) stageRef.current.style.transform = "rotateX(14deg)";
  };

  return (
    <div className="perspective-[1400px]" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div
        ref={stageRef}
        className="relative overflow-hidden rounded-[20px] border border-white/10 bg-gradient-to-b from-[#13161b] to-[#0d0f12] shadow-[0_60px_140px_-40px_rgba(0,0,0,.9),0_0_0_1px_rgba(255,255,255,.02)_inset] [transform-style:preserve-3d] [transform:rotateX(14deg)] [transition:transform_.5s_cubic-bezier(.2,.8,.2,1)]"
      >
        <div
          ref={spotRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[3]"
          style={{
            background: "radial-gradient(420px circle at 50% 0%, rgba(255,255,255,.06), transparent 60%)",
          }}
        />

        <div className="flex items-center gap-2 border-b border-white/[.07] px-[18px] py-[13px]">
          <span className="size-2.5 rounded-full bg-[#2a2e35]" />
          <span className="size-2.5 rounded-full bg-[#2a2e35]" />
          <span className="size-2.5 rounded-full bg-[#2a2e35]" />
          <span className="ml-2.5 font-mono text-xs text-[#7d848f]">somethingai / compile</span>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-xs" style={{ color: visible.statusColor }}>
            <span
              className="size-1.5 rounded-full [animation:compile-dot_1.4s_infinite]"
              style={{ background: visible.statusColor }}
            />
            {visible.status}
          </span>
        </div>

        <div
          className="min-h-[118px] border-b border-white/[.07] px-7 pt-[26px] pb-[22px] text-left transition-opacity duration-500"
          style={{ opacity: visible.fade }}
        >
          <div className="mb-2.5 font-mono text-[11px] font-medium tracking-[0.08em] text-[#7d848f]">
            PROMPT
          </div>
          <p className="text-[clamp(18px,2.1vw,25px)] leading-[1.5] font-medium tracking-[-0.015em] text-[#eef0f3]">
            {visible.segs.map((seg, index) => (
              <span
                key={`${scene}-${index}`}
                className="relative rounded-md transition-all duration-300"
                style={{
                  padding: seg.pad,
                  background: seg.bg,
                  color: seg.color,
                  boxShadow: seg.ring,
                }}
              >
                {seg.text}
                {seg.on ? (
                  <sup className="ml-1 font-mono text-[10px] font-semibold" style={{ color: seg.color }}>
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

        <div
          className="relative h-[clamp(300px,34vw,380px)] bg-size-[20px_20px] transition-opacity duration-500 [background-image:radial-gradient(rgba(255,255,255,.07)_1px,transparent_1px)]"
          style={{ opacity: visible.fade }}
        >
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
                    transition: "stroke-dashoffset .7s cubic-bezier(.6,0,.2,1)",
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
                    transition: "opacity .5s",
                  }}
                />
              </g>
            ))}
          </svg>

          {visible.nodes.map((node) => (
            <div
              key={`${scene}-${node.num}`}
              className="absolute w-[min(200px,22%)] rounded-xl px-[13px] py-[11px] text-left [transition:all_.6s_cubic-bezier(.2,.9,.25,1.2)]"
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: `translate(-50%,-50%) translateZ(${node.z}px) scale(${node.s})`,
                opacity: node.o,
                filter: `blur(${node.b}px)`,
                background: "#15181d",
                border: `1px solid ${node.border}`,
                boxShadow: node.glow,
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
              <div className="mt-1.5 text-[13.5px] leading-[1.3] font-medium text-[#eef0f3]">{node.t}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
