import { CronExpressionParser } from "cron-parser";

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
 * Validates a one-off run time.
 *
 * A time already in the past is refused rather than accepted: the scheduler
 * would treat it as overdue and fire it on its next tick, which for a
 * workflow that sends email is the worst possible reading of a typo.
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

/** "Once on Fri, Oct 3 at 14:00 (America/New_York)". */
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
  // toLocaleString joins the date and time with a comma; "at" reads better
  // and matches describeSchedule.
  return `Once on ${when.replace(/, (\d\d:\d\d)$/, " at $1")} (${timezone})`;
}

/**
 * Human-readable rendering of a schedule, for confirming a generated workflow
 * before it is saved.
 *
 * Only patterns it can state exactly are put into words. Anything else is
 * labelled as a custom schedule with the raw expression, rather than guessed
 * at: a confidently wrong description of when something will run is worse
 * than an honest "custom".
 */
export function describeSchedule(cron: string, timezone: string): string {
  const custom = `Custom schedule: ${cron} (${timezone})`;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return custom;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const numeric = /^\d+$/;
  if (!numeric.test(minute) || month !== "*") return custom;

  if (hour === "*") {
    return dayOfMonth === "*" && dayOfWeek === "*"
      ? `Every hour at :${minute.padStart(2, "0")} (${timezone})`
      : custom;
  }
  if (!numeric.test(hour)) return custom;

  const at = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

  if (numeric.test(dayOfMonth) && dayOfWeek === "*") {
    return `Every month on the ${ordinal(Number(dayOfMonth))} at ${at} (${timezone})`;
  }
  if (dayOfMonth !== "*") return custom;

  if (dayOfWeek === "*") return `Every day at ${at} (${timezone})`;
  if (dayOfWeek === "1-5") return `Every weekday at ${at} (${timezone})`;

  const days = parseDayList(dayOfWeek);
  if (!days) return custom;
  return `Every ${joinWords(days.map((day) => DAY_NAMES[day]))} at ${at} (${timezone})`;
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

/**
 * "1,3,5" to [1, 3, 5], sorted Monday-first the way people list a week.
 * Null for ranges, steps or anything else not a plain list of days.
 */
export function parseDayList(field: string): number[] | null {
  if (!/^[0-7](,[0-7])*$/.test(field)) return null;
  // Cron allows 7 as a second spelling of Sunday.
  const days = [...new Set(field.split(",").map((day) => Number(day) % 7))];
  return days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

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
