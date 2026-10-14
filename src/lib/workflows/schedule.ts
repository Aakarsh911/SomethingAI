import { CronExpressionParser } from "cron-parser";
import type { WorkflowTrigger } from "@/generated/prisma/enums";

/**
 * Turning a cron expression plus an IANA zone into the next UTC instant.
 *
 * The split matters. `cron` and `timezone` are the source of truth and are
 * what the user edits; `nextRunAt` is derived and exists only so the scheduler
 * can select on an index instead of evaluating every expression each tick.
 * Storing the UTC instant *alone* would be wrong — see `assertValidSchedule`.
 */

export class ScheduleError extends Error {}

/** Rejects anything `Intl` will not accept as an IANA zone. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a cron expression against a zone.
 *
 * Both halves are checked because they fail differently: cron-parser rejects a
 * malformed expression, but silently accepts a nonsense timezone like
 * "Mars/Phobos" and falls back to UTC. A schedule that quietly runs in the
 * wrong zone is worse than one that refuses to save.
 */
export function assertValidSchedule(cron: string, timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new ScheduleError(`"${timezone}" is not a valid IANA timezone.`);
  }

  try {
    CronExpressionParser.parse(cron, { tz: timezone });
  } catch (cause) {
    throw new ScheduleError(
      `"${cron}" is not a valid cron expression: ${(cause as Error).message}`,
    );
  }
}

/**
 * The next time this schedule is due, as a UTC instant.
 *
 * Computed from the zone rather than from a stored UTC offset, so it stays
 * correct across DST transitions. For "0 9 * * 4" in America/New_York this
 * returns 14:00Z in January and 13:00Z in July — the same 09:00 local both
 * times, which is what the user asked for and what a fixed UTC time would
 * quietly get wrong.
 */
export function nextRunAt(
  cron: string,
  timezone: string,
  after: Date = new Date(),
): Date {
  assertValidSchedule(cron, timezone);
  return CronExpressionParser.parse(cron, {
    tz: timezone,
    currentDate: after,
  })
    .next()
    .toDate();
}

/**
 * Validates a one-off run time. A past time is refused, since the scheduler
 * would treat it as overdue and fire it straight away.
 */
export function assertValidRunAt(
  runAt: Date,
  timezone: string,
  now: Date = new Date(),
): void {
  if (Number.isNaN(runAt.getTime())) {
    throw new ScheduleError("That run time is not a valid date.");
  }
  if (!isValidTimezone(timezone)) {
    throw new ScheduleError(`"${timezone}" is not a valid IANA timezone.`);
  }
  if (runAt.getTime() <= now.getTime()) {
    throw new ScheduleError("That time has already passed. Pick one in the future.");
  }
}

/** The triggers a user can choose in the studio. WEBHOOK is not one yet. */
export const USER_TRIGGERS = ["MANUAL", "SCHEDULE", "ONCE"] as const satisfies readonly WorkflowTrigger[];
export type UserTrigger = (typeof USER_TRIGGERS)[number];

/** The triggers the AI builder can write. It never asks for a date, so no ONCE. */
export const GENERATED_TRIGGERS = ["MANUAL", "SCHEDULE"] as const satisfies readonly UserTrigger[];
export type GeneratedTrigger = (typeof GENERATED_TRIGGERS)[number];

export function isUserTrigger(value: unknown): value is UserTrigger {
  return (USER_TRIGGERS as readonly unknown[]).includes(value);
}

/** A workflow's schedule columns as the studio receives them. */
export type WorkflowSchedule = {
  trigger: WorkflowTrigger;
  isEnabled: boolean;
  cron: string | null;
  timezone: string | null;
  /** ISO instants. */
  runAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export function scheduleView(workflow: {
  trigger: WorkflowSchedule["trigger"];
  isEnabled: boolean;
  cron: string | null;
  timezone: string | null;
  runAt: Date | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
}): WorkflowSchedule {
  return {
    trigger: workflow.trigger,
    isEnabled: workflow.isEnabled,
    cron: workflow.cron,
    timezone: workflow.timezone,
    runAt: workflow.runAt?.toISOString() ?? null,
    nextRunAt: workflow.nextRunAt?.toISOString() ?? null,
    lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
  };
}

/** "Fri, Oct 3 at 14:00 (America/New_York)". */
export function describeRunAt(runAt: Date, timezone: string): string {
  const when = runAt.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: runAt.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${when.replace(/, (\d\d:\d\d)$/, " at $1")} (${timezone})`;
}

/**
 * A cron expression in one of the shapes the schedule panel offers. Fields a
 * shape does not use keep a default, so switching shapes keeps the time.
 */
export type SimpleCron = {
  repeat: "hourly" | "daily" | "weekdays" | "days" | "monthly";
  minute: number;
  hour: number;
  /** Cron day numbers, 0 = Sunday. */
  days: number[];
  dayOfMonth: number;
};

export const DEFAULT_CRON: SimpleCron = {
  repeat: "daily",
  minute: 0,
  hour: 9,
  days: [1],
  dayOfMonth: 1,
};

/** Null for anything the panel cannot represent, which it keeps as custom. */
export function parseSimpleCron(cron: string): SimpleCron | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [min, hr, dom, month, dow] = fields;

  const inRange = (value: string, low: number, high: number) =>
    /^\d{1,2}$/.test(value) && Number(value) >= low && Number(value) <= high
      ? Number(value)
      : null;

  const minute = inRange(min, 0, 59);
  if (minute === null || month !== "*") return null;
  if (hr === "*") {
    return dom === "*" && dow === "*" ? { ...DEFAULT_CRON, repeat: "hourly", minute } : null;
  }

  const hour = inRange(hr, 0, 23);
  if (hour === null) return null;
  const base = { ...DEFAULT_CRON, minute, hour };

  if (dom !== "*") {
    const dayOfMonth = inRange(dom, 1, 31);
    return dayOfMonth !== null && dow === "*"
      ? { ...base, repeat: "monthly", dayOfMonth }
      : null;
  }
  if (dow === "*") return { ...base, repeat: "daily" };
  if (dow === "1-5") return { ...base, repeat: "weekdays" };

  // A plain list like "1,3,5"; 7 is cron's second spelling of Sunday.
  if (!/^[0-7](,[0-7])*$/.test(dow)) return null;
  const days = [...new Set(dow.split(",").map((day) => Number(day) % 7))];
  return { ...base, repeat: "days", days };
}

export function buildCron(cron: SimpleCron): string {
  const { minute, hour } = cron;
  switch (cron.repeat) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "days":
      return `${minute} ${hour} * * ${cron.days.join(",")}`;
    case "monthly":
      return `${minute} ${hour} ${cron.dayOfMonth} * *`;
  }
}

/** A schedule in words, or the raw expression when it is not a simple shape. */
export function describeSchedule(cron: string, timezone: string): string {
  const simple = parseSimpleCron(cron);
  if (!simple) return `Custom schedule: ${cron} (${timezone})`;

  return `${describeSimpleCron(simple)} (${timezone})`;
}

function describeSimpleCron(cron: SimpleCron): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const at = `${pad(cron.hour)}:${pad(cron.minute)}`;

  switch (cron.repeat) {
    case "hourly":
      return `Every hour at :${pad(cron.minute)}`;
    case "daily":
      return `Every day at ${at}`;
    case "weekdays":
      return `Every weekday at ${at}`;
    case "days": {
      // Listed Monday first, the way people read a week.
      const week = [...cron.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      return `Every ${joinWords(week.map((day) => DAY_NAMES[day]))} at ${at}`;
    }
    case "monthly":
      return `Every month on the ${ordinal(cron.dayOfMonth)} at ${at}`;
  }
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** 1st, 2nd, 3rd, 11th, 31st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}
