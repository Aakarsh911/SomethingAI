"use client";

import MetricCard, {
  type MetricEvent,
  type MetricPoint,
} from "@/components/kokonutui/metric-card";
import { StatusIsland, type IslandTask } from "@/components/kokonutui/status-island";
import UptimeCard, { type UptimeService } from "@/components/kokonutui/uptime-card";
import { BentoGrid } from "@/components/ui/bento-grid";

const DAY = 86_400_000;

function runHistory(days: number, end: string): MetricPoint[] {
  let seed = 19;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  const last = Date.parse(`${end}T00:00:00Z`);
  const out: MetricPoint[] = [];
  let succeeded = 18;
  let held = 4;
  let dry = 6;
  for (let i = 0; i < days; i++) {
    const t = last - (days - 1 - i) * DAY;
    const weekend = [0, 6].includes(new Date(t).getUTCDay());
    succeeded += 0.35 + (random() - 0.4) * 2.2;
    held += 0.12 + (random() - 0.48) * 0.45;
    dry += 0.14 + (random() - 0.5) * 0.7;
    const scale = weekend ? 0.38 : 1;
    out.push({
      date: new Date(t).toISOString().slice(0, 10),
      parts: [
        Math.max(0, Math.round(succeeded * scale)),
        Math.max(0, Math.round(held * scale)),
        Math.max(0, Math.round(dry * scale)),
      ],
    });
  }
  return out;
}

const RUNS = runHistory(180, "2026-11-02");
const RUN_EVENTS: MetricEvent[] = [
  { date: RUNS[159].date, label: "Stripe watch live" },
  { date: RUNS[172].date, label: "Monday digest" },
];

const SERVICES: UptimeService[] = [
  {
    name: "Monday digest",
    incidents: {
      62: {
        title: "Gmail drafts delayed",
        status: "degraded",
        minutes: 14,
        updates: [
          { time: "09:02", label: "Investigating", note: "OAuth token refresh lagged." },
          { time: "09:16", label: "Resolved", note: "Token renewed; drafts sent in order." },
        ],
      },
    },
  },
  {
    name: "Stripe watch",
    incidents: {
      31: {
        title: "List charges timed out",
        status: "degraded",
        minutes: 9,
        updates: [
          { time: "11:40", label: "Investigating" },
          { time: "11:49", label: "Resolved", note: "Retried; 3 drafts queued." },
        ],
      },
    },
  },
  { name: "Gmail drafts" },
  { name: "Linear log", missing: 48 },
];

const TASKS: IslandTask[] = [
  { id: "t1", label: "Monday digest", detail: "step 3 of 4", status: "running", progress: 0.68 },
  { id: "t2", label: "Stripe watch", detail: "queued", status: "running", progress: 0.22 },
];

/** Runs and schedule health after a workflow ships. */
export function ReadableAutomation() {
  return (
    <section id="features" className="mt-24 py-24 sm:mt-28 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-brand">After it ships</p>
            <h2 className="mt-3 max-w-lg text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
              Every run leaves a record.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            How many went through, how many held, and whether the schedule kept
            its word. Hover the island for everything in flight.
          </p>
        </div>

        <div className="mt-10 flex justify-center">
          <StatusIsland tasks={TASKS} dismissAfter={120_000} />
        </div>

        <BentoGrid className="mt-12 max-w-6xl md:auto-rows-auto md:grid-cols-2">
          <MetricCard
            className="max-w-none"
            label="Runs completed"
            segments={["Succeeded", "Held", "Dry-run"]}
            data={RUNS}
            events={RUN_EVENTS}
            format="number"
          />

          <UptimeCard
            className="max-w-none"
            title="Scheduled workflows"
            services={SERVICES}
            endDate="2026-11-02"
          />
        </BentoGrid>
      </div>
    </section>
  );
}
