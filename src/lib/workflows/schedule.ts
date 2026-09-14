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
 * Human-readable rendering of a schedule, for confirming a generated workflow
 * before it is saved.
 *
 * Deliberately falls back to the raw expression rather than guessing: showing
 * a confidently wrong description of when something will run is worse than
 * showing the cron itself.
 */
export function describeSchedule(cron: string, timezone: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return `${cron} (${timezone})`;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const numeric = /^\d+$/;
  if (!numeric.test(minute) || !numeric.test(hour)) return `${cron} (${timezone})`;

  const at = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  if (dayOfMonth === "*" && month === "*") {
    if (dayOfWeek === "*") return `Every day at ${at} (${timezone})`;
    if (numeric.test(dayOfWeek)) {
      const day = days[Number(dayOfWeek) % 7];
      return `Every ${day} at ${at} (${timezone})`;
    }
    if (dayOfWeek === "1-5") return `Every weekday at ${at} (${timezone})`;
  }

  return `${cron} (${timezone})`;
}
