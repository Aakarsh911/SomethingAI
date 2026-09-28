"use client";

import { useState } from "react";
import {
  DAY_NAMES,
  describeSchedule,
  ordinal,
  parseDayList,
} from "@/lib/workflows/schedule";
import type { WorkflowSchedule } from "./schedule-context";

/**
 * Editor for when a workflow runs: only on demand, on a repeating schedule,
 * or once at a set date and time.
 *
 * Saved explicitly rather than autosaved like the graph. A half-typed time
 * that autosaves is a real send at the wrong moment, and the server's
 * refusal ("that time has passed") needs somewhere to be shown.
 */

const fieldClass =
  "w-full rounded-lg border border-[#ebebeb] bg-transparent px-2 py-1.5 text-sm text-black outline-none focus:border-neutral-400 dark:border-[#1a1a1a] dark:text-[#ededed] dark:focus:border-[#444]";

const labelClass = "text-xs font-medium text-black dark:text-[#ededed]";
const hintClass = "text-[11px] leading-snug text-[#666] dark:text-[#999]";

const primaryButton =
  "h-8 cursor-pointer rounded-full border border-transparent bg-black px-3 text-sm font-medium text-neutral-50 transition-all duration-200 hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#ededed] dark:text-black dark:hover:bg-[#ccc]";

/** Monday first, the way the week is usually read. Values are cron days. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

type Mode = "MANUAL" | "SCHEDULE" | "ONCE";
/**
 * "custom" is never offered as a choice. It exists only to keep an
 * expression the AI builder wrote that none of the plain options can say.
 */
type Repeat = "hourly" | "daily" | "weekdays" | "days" | "monthly" | "custom";

export type SchedulePatch = {
  trigger: Mode;
  cron: string | null;
  timezone: string | null;
  runAt: string | null;
  isEnabled: boolean;
};

export function ScheduleInspector({
  schedule,
  onSave,
  onClose,
}: {
  schedule: WorkflowSchedule;
  /** Resolves to an error message, or null once saved. */
  onSave: (patch: SchedulePatch) => Promise<string | null>;
  onClose: () => void;
}) {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parsed = parseCron(schedule.cron);
  // Switched off by the worker after running, not by the user.
  const fired =
    schedule.trigger === "ONCE" &&
    !schedule.isEnabled &&
    schedule.runAt !== null &&
    schedule.lastRunAt !== null &&
    new Date(schedule.lastRunAt).getTime() >= new Date(schedule.runAt).getTime();

  const [mode, setMode] = useState<Mode>(
    schedule.trigger === "SCHEDULE" || schedule.trigger === "ONCE"
      ? schedule.trigger
      : "MANUAL",
  );
  const [repeat, setRepeat] = useState<Repeat>(parsed.repeat);
  const [days, setDays] = useState(parsed.days);
  const [dayOfMonth, setDayOfMonth] = useState(parsed.dayOfMonth);
  const [time, setTime] = useState(parsed.time);
  const [runAtLocal, setRunAtLocal] = useState(() =>
    toLocalInput(
      schedule.trigger === "ONCE" && schedule.runAt && !fired
        ? new Date(schedule.runAt)
        : nextFullHour(),
    ),
  );
  // A new schedule starts switched on: picking a time and pressing Save is
  // the deliberate act that the workflow being created "off" waits for. The
  // same goes for giving a one-off that already ran a new time.
  const [enabled, setEnabled] = useState(
    schedule.trigger === "MANUAL" || fired ? true : schedule.isEnabled,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A recurring schedule keeps the zone it was written in, so reopening it on
  // a laptop in another zone does not quietly move it. A one-off time is
  // picked on a local clock, so it is always read in the browser's zone.
  const zone =
    mode === "SCHEDULE" && schedule.trigger === "SCHEDULE" && schedule.timezone
      ? schedule.timezone
      : browserZone;

  function buildCron(): string {
    if (repeat === "custom") return schedule.cron ?? "";
    const [hour, minute] = time.split(":").map(Number);
    if (repeat === "hourly") return `${minute} * * * *`;
    if (repeat === "monthly") return `${minute} ${hour} ${dayOfMonth} * *`;
    const dow =
      repeat === "daily" ? "*" : repeat === "weekdays" ? "1-5" : days.join(",");
    return `${minute} ${hour} * * ${dow}`;
  }

  function toggleDay(day: number) {
    setDays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    let patch: SchedulePatch;
    if (mode === "SCHEDULE") {
      if (repeat === "days" && days.length === 0) {
        setSaving(false);
        setError("Pick at least one day.");
        return;
      }
      patch = { trigger: mode, cron: buildCron(), timezone: zone, runAt: null, isEnabled: enabled };
    } else if (mode === "ONCE") {
      // datetime-local has no zone; the Date constructor reads it as local
      // time, which is the zone the user was looking at when they picked it.
      const runAt = new Date(runAtLocal);
      if (!runAtLocal || Number.isNaN(runAt.getTime())) {
        setSaving(false);
        setError("Pick a date and time.");
        return;
      }
      patch = {
        trigger: mode,
        cron: null,
        timezone: zone,
        runAt: runAt.toISOString(),
        isEnabled: enabled,
      };
    } else {
      patch = { trigger: mode, cron: null, timezone: null, runAt: null, isEnabled: false };
    }

    const failure = await onSave(patch);
    setSaving(false);
    if (failure) setError(failure);
    else setSaved(true);
  }

  return (
    <aside className="absolute top-0 right-0 z-30 flex h-full w-80 flex-col border-l border-[#ebebeb] bg-white dark:border-[#1a1a1a] dark:bg-neutral-950">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-[#ebebeb] px-3 py-2 dark:border-[#1a1a1a]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
            Trigger
          </p>
          <p className="text-xs text-black dark:text-[#ededed]">When this workflow runs</p>
        </div>
        <button
          type="button"
          aria-label="Close schedule"
          className="cursor-pointer rounded px-1 text-sm text-[#666] hover:text-black dark:hover:text-[#ededed]"
          onClick={onClose}
        >
          &times;
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {schedule.trigger === "WEBHOOK" ? (
          <p className={`mb-3 ${hintClass}`}>
            This workflow runs from a webhook. Saving a schedule here replaces it.
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-1.5">
          <legend className={labelClass}>Runs</legend>
          {(
            [
              ["MANUAL", "Only when I click Run now"],
              ["SCHEDULE", "On a repeating schedule"],
              ["ONCE", "Once, at a date and time"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="schedule-mode"
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setSaved(false);
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {mode === "SCHEDULE" ? (
          <section className="mt-4 flex flex-col gap-3 border-t border-[#ebebeb] pt-3 dark:border-[#1a1a1a]">
            <div>
              <label className={labelClass} htmlFor="schedule-repeat">
                Repeat
              </label>
              <select
                id="schedule-repeat"
                className={`${fieldClass} mt-1`}
                value={repeat}
                onChange={(event) => setRepeat(event.target.value as Repeat)}
              >
                <option value="hourly">Every hour</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Every weekday (Mon–Fri)</option>
                <option value="days">On certain days of the week</option>
                <option value="monthly">Every month</option>
                {parsed.repeat === "custom" ? (
                  <option value="custom">Keep the current custom schedule</option>
                ) : null}
              </select>
            </div>

            {repeat === "days" ? (
              <fieldset>
                <legend className={labelClass}>On</legend>
                <div className="mt-1 flex flex-wrap gap-1">
                  {WEEK.map((day) => {
                    const active = days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={active}
                        className={`h-7 w-10 cursor-pointer rounded-full border text-xs ${
                          active
                            ? "border-transparent bg-black text-neutral-50 dark:bg-[#ededed] dark:text-black"
                            : "border-[#ebebeb] text-black hover:bg-[#f2f2f2] dark:border-[#1a1a1a] dark:text-[#ededed] dark:hover:bg-[#1a1a1a]"
                        }`}
                        onClick={() => toggleDay(day)}
                      >
                        {DAY_NAMES[day].slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {repeat === "monthly" ? (
              <div>
                <label className={labelClass} htmlFor="schedule-day-of-month">
                  On day
                </label>
                <select
                  id="schedule-day-of-month"
                  className={`${fieldClass} mt-1`}
                  value={dayOfMonth}
                  onChange={(event) => setDayOfMonth(Number(event.target.value))}
                >
                  {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {dayOfMonth > 28 ? (
                  <p className={`mt-1 ${hintClass}`}>
                    Months without a {ordinal(dayOfMonth)} are skipped.
                  </p>
                ) : null}
              </div>
            ) : null}

            {repeat === "hourly" ? (
              <div>
                <label className={labelClass} htmlFor="schedule-minute">
                  At minutes past the hour
                </label>
                <select
                  id="schedule-minute"
                  className={`${fieldClass} mt-1`}
                  value={Number(time.split(":")[1])}
                  onChange={(event) =>
                    setTime(`${time.split(":")[0]}:${event.target.value.padStart(2, "0")}`)
                  }
                >
                  {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => (
                    <option key={minute} value={minute}>
                      :{String(minute).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
            ) : repeat !== "custom" ? (
              <div>
                <label className={labelClass} htmlFor="schedule-time">
                  At
                </label>
                <input
                  id="schedule-time"
                  type="time"
                  className={`${fieldClass} mt-1`}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
            ) : null}

            {/* Read back in words, so what gets saved is confirmed in the
                same terms the user thinks in. */}
            <p className="rounded-lg bg-[#f5f5f5] px-2 py-1.5 text-xs text-black dark:bg-[#1a1a1a] dark:text-[#ededed]">
              {repeat === "days" && days.length === 0
                ? "Pick at least one day."
                : describeSchedule(buildCron(), zone)}
            </p>
          </section>
        ) : null}

        {mode === "ONCE" ? (
          <section className="mt-4 flex flex-col gap-3 border-t border-[#ebebeb] pt-3 dark:border-[#1a1a1a]">
            <div>
              <label className={labelClass} htmlFor="schedule-run-at">
                Date and time
              </label>
              <input
                id="schedule-run-at"
                type="datetime-local"
                className={`${fieldClass} mt-1`}
                value={runAtLocal}
                min={toLocalInput(new Date())}
                onChange={(event) => setRunAtLocal(event.target.value)}
              />
            </div>
            <p className={hintClass}>
              In {zone}. After it runs, the workflow switches itself off.
            </p>
            {fired ? (
              <p className={hintClass}>
                This already ran. Pick a new time to run it again.
              </p>
            ) : null}
          </section>
        ) : null}

        {mode !== "MANUAL" ? (
          <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-[#ebebeb] pt-3 text-sm dark:border-[#1a1a1a]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              On
              <span className={`block ${hintClass}`}>
                Off keeps the schedule but nothing runs. Run now still works.
              </span>
            </span>
          </label>
        ) : null}

        {schedule.nextRunAt && schedule.isEnabled ? (
          <p className={`mt-4 ${hintClass}`}>
            Next run: {new Date(schedule.nextRunAt).toLocaleString()}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 text-[11px] text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        {saved ? <p className={`mt-3 ${hintClass}`}>Saved.</p> : null}
      </div>

      <footer className="shrink-0 border-t border-[#ebebeb] px-3 py-2 dark:border-[#1a1a1a]">
        <button
          type="button"
          className={`${primaryButton} w-full`}
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
      </footer>
    </aside>
  );
}

/**
 * Reads a stored cron back into the plain controls when it is one they could
 * have written, and keeps it as "custom" otherwise — the same rule
 * describeSchedule follows.
 */
function parseCron(cron: string | null): {
  repeat: Repeat;
  days: number[];
  dayOfMonth: number;
  time: string;
} {
  const fallback = { repeat: "daily" as Repeat, days: [1], dayOfMonth: 1, time: "09:00" };
  if (!cron) return fallback;

  const fields = cron.trim().split(/s+/);
  if (fields.length !== 5) return { ...fallback, repeat: "custom" };
  const [minute, hour, dom, month, dow] = fields;
  const inRange = (value: string, max: number) =>
    /^d{1,2}$/.test(value) && Number(value) <= max;
  if (!inRange(minute, 59) || month !== "*") return { ...fallback, repeat: "custom" };

  const mm = minute.padStart(2, "0");
  if (hour === "*" && dom === "*" && dow === "*") {
    return { ...fallback, repeat: "hourly", time: `09:${mm}` };
  }
  if (!inRange(hour, 23)) return { ...fallback, repeat: "custom" };

  const time = `${hour.padStart(2, "0")}:${mm}`;
  if (dom !== "*") {
    return dow === "*" && inRange(dom, 31) && Number(dom) >= 1
      ? { ...fallback, repeat: "monthly", dayOfMonth: Number(dom), time }
      : { ...fallback, repeat: "custom" };
  }
  if (dow === "*") return { ...fallback, repeat: "daily", time };
  if (dow === "1-5") return { ...fallback, repeat: "weekdays", time };

  const days = parseDayList(dow);
  return days
    ? { ...fallback, repeat: "days", days, time }
    : { ...fallback, repeat: "custom" };
}

/** The value a datetime-local input expects, in the browser's zone. */
function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function nextFullHour(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}
