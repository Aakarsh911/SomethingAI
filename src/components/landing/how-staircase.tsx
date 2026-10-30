"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const FEATURES: {
  title: string;
  body: string;
  sample?: string;
  color: string;
}[] = [
  {
    title: "Describe it",
    body: "A sentence is enough. Write what you want in the tools you already use.",
    sample: "Every Thursday, draft a summary of unread mail.",
    color: "var(--g-blue)",
  },
  {
    title: "It asks back",
    body: "If something is ambiguous — which inbox, what time — it asks instead of guessing.",
    sample: "Which inbox should I read?",
    color: "var(--g-green)",
  },
  {
    title: "Review the graph",
    body: "Words become steps you can inspect. A trigger, tool calls and model steps you can rewire, edit, or change by asking.",
    sample: "gmail.fetch_emails → model.summarize",
    color: "var(--g-yellow)",
  },
  {
    title: "Test it",
    body: "Walk the whole workflow without calling a tool. Nothing is sent, opened, or posted until you say so.",
    sample: "Test run · Nothing was sent",
    color: "var(--g-red)",
  },
  {
    title: "Schedule and run",
    body: "When it looks right, put it on a schedule. Every run is logged.",
    sample: "Every Thursday at 8:00 AM",
    color: "var(--g-blue)",
  },
];

const N = FEATURES.length;
const H = 520;
const DX = 26;
const DY = 15;
const TOPS = FEATURES.map((_, i) => 150 + i * 50);

const stepStyle = (color: string, extra?: CSSProperties): CSSProperties =>
  ({ ...extra, "--stf-c": color }) as CSSProperties;

function StepArt({ step }: { step: number }) {
  return (
    <div className="stf-art" aria-hidden>
      <div className="stf-art-panel" />
      {step === 0 ? (
        <svg className="stf-art-svg" viewBox="0 0 100 100" preserveAspectRatio="xMinYMin meet">
          <rect className="stf-p stf-art-soft" x="16" y="8" width="68" height="30" rx="10" />
          <rect className="stf-p stf-art-mid" x="12" y="18" width="76" height="34" rx="10" />
          <rect className="stf-p stf-art-hard" x="16" y="32" width="68" height="56" rx="12" />
          <rect className="stf-p stf-art-lite" x="28" y="46" width="44" height="6" rx="3" />
          <rect className="stf-p stf-art-lite" x="28" y="58" width="32" height="6" rx="3" />
          <rect className="stf-p stf-art-lite" x="28" y="70" width="22" height="6" rx="3" />
        </svg>
      ) : null}
      {step === 1 ? (
        <svg className="stf-art-svg" viewBox="0 0 100 100" preserveAspectRatio="xMinYMin meet">
          <rect className="stf-p stf-art-soft" x="6" y="8" width="62" height="34" rx="16" />
          <circle className="stf-p stf-art-ink" cx="22" cy="25" r="3.5" />
          <circle className="stf-p stf-art-ink" cx="32" cy="25" r="3.5" />
          <circle className="stf-p stf-art-ink" cx="42" cy="25" r="3.5" />
          <rect className="stf-p stf-art-hard" x="32" y="50" width="62" height="38" rx="16" />
          <rect className="stf-p stf-art-lite" x="44" y="62" width="36" height="5" rx="2.5" />
          <rect className="stf-p stf-art-lite" x="44" y="72" width="22" height="5" rx="2.5" />
        </svg>
      ) : null}
      {step === 2 ? (
        <svg className="stf-art-svg" viewBox="0 0 100 100" preserveAspectRatio="xMinYMin meet">
          <line className="stf-p stf-art-stroke" x1="28" y1="32" x2="48" y2="68" />
          <line className="stf-p stf-art-stroke" x1="72" y1="30" x2="52" y2="66" />
          <circle className="stf-p stf-art-soft" cx="24" cy="26" r="14" />
          <circle className="stf-p stf-art-mid" cx="76" cy="24" r="12" />
          <circle className="stf-p stf-art-hard" cx="50" cy="74" r="16" />
          <circle className="stf-p stf-art-lite" cx="50" cy="74" r="6" />
        </svg>
      ) : null}
      {step === 3 ? (
        <svg className="stf-art-svg" viewBox="0 0 100 100" preserveAspectRatio="xMinYMin meet">
          <circle className="stf-p stf-art-ring" cx="50" cy="50" r="42" />
          <circle className="stf-p stf-art-soft" cx="50" cy="50" r="30" />
          <rect className="stf-p stf-art-hard" x="28" y="28" width="44" height="44" rx="12" />
          <path className="stf-p stf-art-check" d="M38 52 L46 60 L64 40" />
        </svg>
      ) : null}
      {step === 4 ? (
        <svg className="stf-art-svg" viewBox="0 0 100 100" preserveAspectRatio="xMinYMin meet">
          <circle className="stf-p stf-art-soft" cx="50" cy="50" r="40" />
          <circle className="stf-p stf-art-hard" cx="50" cy="50" r="28" />
          <path className="stf-p stf-art-lite" d="M50 50 L50 26 A24 24 0 0 1 70 50 Z" />
          <circle className="stf-p stf-art-ink" cx="50" cy="50" r="4.5" />
        </svg>
      ) : null}
    </div>
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const pts = (pairs: [number, number][]) => pairs.map((p) => p.join(",")).join(" ");
const unit = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

function puffAt(
  wrap: HTMLDivElement,
  i: number,
  x: number,
  y: number,
  count = 7,
) {
  for (let k = 0; k < count; k += 1) {
    const dot = document.createElement("div");
    dot.className = "stf-puff";
    wrap.appendChild(dot);
    const dir = k < count / 2 ? -1 : 1;
    const dx = dir * (10 + unit(i * 11 + k) * 18);
    const dy = -(3 + unit(i * 17 + k + 3) * 9);
    const sz = 0.5 + unit(i * 23 + k + 7) * 0.7;
    const duration = 600 + unit(i * 29 + k + 9) * 250;
    dot
      .animate(
        [
          { transform: `translate(${x}px, ${y}px) scale(${sz})`, opacity: 0.8 },
          { transform: `translate(${x + dx}px, ${y + dy}px) scale(${sz * 1.7})`, opacity: 0 },
        ],
        { duration, easing: "cubic-bezier(.15,.85,.25,1)" },
      )
      .finished.then(() => dot.remove())
      .catch(() => dot.remove());
  }
}

function tween(duration: number, fn: (p: number) => void) {
  return new Promise<void>((resolve) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      fn(p);
      if (p < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** How-it-works staircase, ported from the v4 artifact. */
export function HowStaircase() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const guyRef = useRef<SVGSVGElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(0);
  const curRef = useRef(0);
  const shownCardRef = useRef(-1);
  const startedRef = useRef(false);

  const [width, setWidth] = useState(0);
  const [entered, setEntered] = useState(() => FEATURES.map(() => false));
  const [railIn, setRailIn] = useState(false);
  const [onIndex, setOnIndex] = useState(-1);
  const [card, setCard] = useState(FEATURES[0]);
  const [cardIndex, setCardIndex] = useState(0);
  const [guyVisible, setGuyVisible] = useState(false);
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const stepW = width > 0 ? (width - DX) / N : 0;

  const posOf = (i: number) => ({
    x: i * stepW + stepW * 0.42 - 15 + DX / 2,
    y: TOPS[i] - DY / 2 - 46,
  });

  const paint = (
    x: number,
    y: number,
    sx = 1,
    sy = 1,
    rot = 0,
    ground: number | null = null,
    op = 1,
  ) => {
    const guy = guyRef.current;
    const shadow = shadowRef.current;
    if (!guy || !shadow) return;
    guy.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${sx}, ${sy})`;
    const gy = ground == null ? y + 46 : ground;
    const lift = Math.max(0, gy - (y + 46));
    const k = Math.max(0, 1 - lift / 70);
    shadow.style.transform = `translate(${x + 4}px, ${gy - 3}px) scale(${0.55 + 0.45 * k})`;
    shadow.style.opacity = String(op * (0.35 + 0.65 * k));
  };

  const place = (i: number) => {
    const p = posOf(i);
    paint(p.x, p.y);
  };

  const puff = (i: number, n = 7) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const p = posOf(i);
    puffAt(wrap, i, p.x + 15, TOPS[i] - DY / 2 - 4, n);
  };

  const setOn = (i: number) => {
    setOnIndex(i);
    if (i < 0 || i === shownCardRef.current) return;
    shownCardRef.current = i;
    setCard(FEATURES[i]);
    setCardIndex(i);
  };

  const hop = async (to: number, duration = 860) => {
    const from = curRef.current;
    const a = posOf(from);
    const b = posOf(to);
    const dir = to > from ? 1 : -1;
    const peak = dir > 0 ? 26 : 44;
    const crouch = 0.2;
    const land = 0.8;
    let landed = false;
    const guy = guyRef.current;

    await tween(duration, (p) => {
      if (p < crouch) {
        const e = easeInOut(p / crouch);
        paint(a.x, a.y, 1 + 0.08 * e, 1 - 0.13 * e, -dir * 2 * e);
        return;
      }
      if (p < land) {
        guy?.classList.add("air");
        const q = (p - crouch) / (land - crouch);
        const x = lerp(a.x, b.x, easeInOut(q));
        const y = lerp(a.y, b.y, q * q * (3 - 2 * q)) - 4 * peak * q * (1 - q);
        const sy = 1 + 0.07 * Math.sin(Math.PI * q) - 0.13 * (1 - q) ** 3;
        const sx = 1 - (sy - 1) * 0.6;
        paint(x, y, sx, sy, dir * 7 * Math.sin(Math.PI * q), lerp(a.y, b.y, q) + 46);
        return;
      }
      if (!landed) {
        landed = true;
        guy?.classList.remove("air");
        curRef.current = to;
        setOn(to);
        puff(to);
      }
      const q = (p - land) / (1 - land);
      const s = Math.sin(Math.PI * easeOutCubic(q)) * (1 - q * 0.3);
      paint(b.x, b.y, 1 + 0.09 * s, 1 - 0.12 * s, 0);
    });
    place(to);
  };

  const walkTo = async (to: number, token: number) => {
    while (curRef.current !== to && token === tokenRef.current) {
      await hop(curRef.current + (to > curRef.current ? 1 : -1), 620);
    }
  };

  const celebrate = async (token: number) => {
    for (let k = 0; k < 2 && token === tokenRef.current; k += 1) {
      const p = posOf(curRef.current);
      const spin = k ? -360 : 360;
      await tween(820, (q) => {
        if (q < 0.18) {
          const e = easeInOut(q / 0.18);
          paint(p.x, p.y, 1 + 0.08 * e, 1 - 0.14 * e, 0);
          return;
        }
        if (q < 0.82) {
          const r = (q - 0.18) / 0.64;
          if (r > 0.05) guyRef.current?.classList.add("air");
          paint(
            p.x,
            p.y - 120 * r * (1 - r),
            1,
            1 + 0.05 * Math.sin(Math.PI * r) - 0.14 * (1 - r) ** 3,
            spin * easeInOut(r),
          );
          return;
        }
        if (guyRef.current?.classList.contains("air")) {
          guyRef.current.classList.remove("air");
          puff(curRef.current, 5);
        }
        const r = (q - 0.82) / 0.18;
        const s = Math.sin(Math.PI * easeOutCubic(r));
        paint(p.x, p.y, 1 + 0.08 * s, 1 - 0.11 * s, 0);
      });
    }
    place(curRef.current);
  };

  const run = async () => {
    const token = ++tokenRef.current;
    curRef.current = 0;
    shownCardRef.current = -1;
    setOnIndex(-1);
    setRailIn(false);
    setGuyVisible(false);
    setEntered(FEATURES.map(() => false));
    guyRef.current?.classList.remove("air");
    if (guyRef.current) guyRef.current.style.opacity = "0";
    if (shadowRef.current) shadowRef.current.style.opacity = "0";

    await wait(150);
    for (let i = 0; i < N; i += 1) {
      if (token !== tokenRef.current) return;
      setEntered((prev) => prev.map((on, index) => (index === i ? true : on)));
      await wait(120);
    }
    await wait(250);
    setRailIn(true);
    await wait(450);
    if (token !== tokenRef.current) return;

    const p = posOf(0);
    guyRef.current?.classList.add("air");
    let landed = false;
    await tween(900, (q) => {
      if (q < 0.6) {
        const r = q / 0.6;
        const e = r * r;
        if (guyRef.current) guyRef.current.style.opacity = String(Math.min(1, r * 3));
        paint(p.x, lerp(p.y - 80, p.y, e), 0.96, 1.06, 0);
        return;
      }
      if (!landed) {
        landed = true;
        guyRef.current?.classList.remove("air");
        setGuyVisible(true);
        setOn(0);
        puff(0);
      }
      const r = (q - 0.6) / 0.4;
      const s = Math.sin(Math.PI * easeOutCubic(r)) * (1 - r * 0.3);
      paint(p.x, p.y, 1 + 0.1 * s, 1 - 0.14 * s, 0);
    });
    place(0);
    await wait(1300);
    for (let i = 1; i < N; i += 1) {
      if (token !== tokenRef.current) return;
      await hop(i);
      if (token !== tokenRef.current) return;
      await wait(1250);
    }
    if (token === tokenRef.current) celebrate(token);
  };

  const sendTo = (i: number) => {
    startedRef.current = true;
    const token = ++tokenRef.current;
    setEntered(FEATURES.map(() => true));
    setRailIn(true);
    setGuyVisible(true);
    if (guyRef.current) guyRef.current.style.opacity = "1";
    if (i === curRef.current) setOn(i);
    walkTo(i, token).then(() => {
      if (token === tokenRef.current && curRef.current === N - 1) celebrate(token);
    });
  };

  const showStatic = () => {
    startedRef.current = true;
    setEntered(FEATURES.map(() => true));
    setRailIn(true);
    setOnIndex(0);
    setCard(FEATURES[0]);
    setCardIndex(0);
    setGuyVisible(true);
    curRef.current = 0;
    if (guyRef.current) guyRef.current.style.opacity = "1";
    place(0);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setWidth(wrap.clientWidth);
    const later = window.setTimeout(measure, 0);
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => {
      window.clearTimeout(later);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || width <= 0) return;
    const target = wrap.closest("#how") ?? wrap;

    const inView = () => {
      const rect = target.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.78 && rect.bottom > 96;
    };

    const start = () => {
      if (startedRef.current) return;
      if (reduce) {
        showStatic();
        return;
      }
      startedRef.current = true;
      void run();
    };

    const onScroll = () => {
      if (inView()) start();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) start();
      },
      { threshold: 0.18, rootMargin: "0px 0px -18% 0px" },
    );
    io.observe(target);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
    // Intro waits until the section is on screen and measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, reduce]);

  useLayoutEffect(() => {
    if (width > 0 && guyVisible) place(curRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, guyVisible, onIndex, entered]);

  const rail = (() => {
    if (stepW <= 0) return null;
    const rh = 52;
    const posts = FEATURES.map((_, i) => {
      const bx = i * stepW + DX + stepW * 0.5;
      const by = TOPS[i] - DY;
      return { bx, by, x: bx, y: by - rh };
    });
    const last = posts[N - 1];
    const first = posts[0];
    const slope = (last.y - first.y) / (last.x - first.x);
    const start: [number, number] = [
      first.x - stepW * 0.32,
      first.y - slope * stepW * 0.32,
    ];
    const end: [number, number] = [last.x + stepW * 0.3, last.y + slope * stepW * 0.3];
    return { posts, start, end };
  })();

  const wash = FEATURES[onIndex >= 0 ? onIndex : 0].color;

  return (
    <section
      id="how"
      className="stf-section mt-16 scroll-mt-24 py-16 sm:mt-20 sm:py-20"
      style={stepStyle(wash)}
    >
      <div className="stf-section-inner mx-auto max-w-6xl px-6">
        <p className="stf-kicker text-sm font-medium">How it works</p>
        <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
          From a sentence to a running workflow.
        </h2>

        <div className="stf mt-14">
        <div ref={wrapRef} className="stf-stage">
          <div
            className={cn("stf-card", onIndex >= 0 && "in")}
            style={stepStyle(card.color)}
          >
            <p className="stf-eyebrow">
              Step {String(cardIndex + 1).padStart(2, "0")} of {String(N).padStart(2, "0")}
            </p>
            <p className="stf-title">{card.title}</p>
            <p className="stf-desc">{card.body}</p>
            {card.sample ? <p className="stf-sample">{card.sample}</p> : null}
            <div className="stf-bars" aria-hidden>
              {FEATURES.map((feature, i) => (
                <div key={feature.title} className="stf-bar">
                  <span
                    style={{
                      width: onIndex >= 0 && i <= onIndex ? "100%" : "0%",
                      background: feature.color,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <svg className="stf-svg" viewBox={`0 0 ${Math.max(width, 1)} ${H}`} aria-hidden>
            <defs>
              <linearGradient id="stf-g-top" x1="0" y1="1" x2="0.4" y2="0">
                <stop offset="0%" stopColor="color-mix(in srgb, var(--foreground) 8%, var(--canvas))" />
                <stop offset="100%" stopColor="color-mix(in srgb, var(--foreground) 14%, var(--canvas))" />
              </linearGradient>
              <linearGradient id="stf-g-front" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="color-mix(in srgb, var(--foreground) 18%, var(--canvas))" />
                <stop offset="22%" stopColor="color-mix(in srgb, var(--foreground) 11%, var(--canvas))" />
                <stop offset="100%" stopColor="color-mix(in srgb, var(--foreground) 7%, var(--canvas))" />
              </linearGradient>
              <linearGradient id="stf-g-side" x1="0" y1="0" x2="1" y2="0.15">
                <stop offset="0%" stopColor="color-mix(in srgb, var(--foreground) 24%, var(--canvas))" />
                <stop offset="100%" stopColor="color-mix(in srgb, var(--foreground) 38%, var(--canvas))" />
              </linearGradient>
              <radialGradient id="stf-g-pool" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--g-blue)" stopOpacity="0.28" />
                <stop offset="70%" stopColor="var(--g-blue)" stopOpacity="0.08" />
                <stop offset="100%" stopColor="var(--g-blue)" stopOpacity="0" />
              </radialGradient>
            </defs>
            {stepW > 0
              ? FEATURES.map((feature, i) => {
                  const x = i * stepW;
                  const y = TOPS[i];
                  const ny = i < N - 1 ? TOPS[i + 1] : H;
                  const poolX = x + stepW * 0.5 + DX * 0.35;
                  const poolY = y - DY * 0.38;
                  return (
                    <g
                      key={feature.title}
                      className={cn(
                        "stf-sg",
                        entered[i] && "in",
                        onIndex === i && "on",
                        onIndex >= 0 && onIndex !== i && "dim",
                      )}
                      style={stepStyle(feature.color)}
                    >
                      <polygon
                        className="stf-sd"
                        points={pts([
                          [x + stepW, y],
                          [x + stepW + DX, y - DY],
                          [x + stepW + DX, ny - DY],
                          [x + stepW, ny],
                        ])}
                      />
                      <rect className="stf-fr" x={x} y={y} width={stepW} height={H - y} />
                      <rect className="stf-shd" x={x} y={y} width={stepW} height={11} />
                      <polygon
                        className="stf-tr"
                        points={pts([
                          [x, y],
                          [x + stepW, y],
                          [x + stepW + DX, y - DY],
                          [x + DX, y - DY],
                        ])}
                      />
                      <ellipse
                        className="stf-pool"
                        cx={poolX}
                        cy={poolY}
                        rx={stepW * 0.22}
                        ry={7.5}
                      />
                      <line
                        className="stf-hl"
                        x1={x + DX}
                        y1={y - DY}
                        x2={x + stepW + DX}
                        y2={y - DY}
                      />
                      <line className="stf-nz" x1={x} y1={y} x2={x + stepW} y2={y} />
                    </g>
                  );
                })
              : null}

            {rail ? (
              <g className={cn("stf-rail", railIn && "in")}>
                {rail.posts.map((post) => (
                  <line
                    key={post.bx}
                    className="stf-bal"
                    x1={post.bx}
                    y1={post.by}
                    x2={post.bx}
                    y2={post.y}
                  />
                ))}
                <polyline
                  className="stf-hand"
                  points={pts([
                    rail.start,
                    ...rail.posts.map((p) => [p.x, p.y] as [number, number]),
                    rail.end,
                  ])}
                />
              </g>
            ) : null}
          </svg>

          {stepW > 0
            ? FEATURES.map((feature, i) => {
                const x = i * stepW;
                const y = TOPS[i];
                return (
                  <button
                    key={feature.title}
                    type="button"
                    className={cn(
                      "stf-lab",
                      i >= N - 2 && "tight",
                      entered[i] && "in",
                      onIndex === i && "on",
                      onIndex >= 0 && onIndex !== i && "dim",
                    )}
                    style={stepStyle(feature.color, {
                      left: x,
                      top: y + 2,
                      width: stepW,
                      height: H - y,
                    })}
                    onClick={() => sendTo(i)}
                    aria-current={onIndex === i ? "step" : undefined}
                    aria-label={`Step ${i + 1}: ${feature.title}`}
                  >
                    <span className="stf-tt">{feature.title}</span>
                    <StepArt step={i} />
                    <span className="stf-big" aria-hidden>
                      {i + 1}
                    </span>
                  </button>
                );
              })
            : null}

          <div ref={shadowRef} className="stf-shadow" aria-hidden />
          <svg
            ref={guyRef}
            className="stf-guy"
            style={{ opacity: guyVisible ? 1 : 0 }}
            viewBox="0 0 30 46"
            aria-hidden
          >
            <g className="body">
              <path className="sc" d="M11 13 Q15 15 19 13 M18 13 Q23 14 26 11" />
              <line className="s" x1="15" y1="14" x2="15" y2="28" />
              <g className="a1">
                <line className="s" x1="15" y1="17" x2="8" y2="24" />
                <line className="s" x1="15" y1="17" x2="22" y2="24" />
              </g>
              <circle className="hd" cx="15" cy="7" r="5.5" />
              <g className="ey">
                <circle cx="13.2" cy="7" r="0.9" />
                <circle cx="16.8" cy="7" r="0.9" />
              </g>
            </g>
            <g className="l1">
              <line className="s" x1="15" y1="28" x2="10" y2="43" />
            </g>
            <g className="l2">
              <line className="s" x1="15" y1="28" x2="20" y2="43" />
            </g>
          </svg>
        </div>

        <div className="mt-3.5 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Click any step to send him there</p>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            onClick={() => {
              startedRef.current = true;
              void run();
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Replay
          </button>
        </div>
        </div>
      </div>
    </section>
  );
}
