"use client";

import { useState } from "react";
import {
  DAY_NAMES,
  DEFAULT_CRON,
  USER_TRIGGERS,
  buildCron,
  describeSchedule,
  isUserTrigger,
  ordinal,
  parseSimpleCron,
  type SimpleCron,
  type UserTrigger,
  type WorkflowSchedule,
} from "@/lib/workflows/schedule";
import { InspectorPanel } from "./inspector-panel";
import {
  errorClass,
  fieldClass,
  hintClass,
  labelClass,
  primaryButtonClass,
} from "./styles";
import { hasFired } from "./schedule-context";

/**
 * Editor for when a workflow runs. Saved explicitly, not autosaved like the
 * graph: an autosaved half-typed time is a real send at the wrong moment.
 */

/** Monday first. Values are cron days. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const MODE_LABELS: Record<UserTrigger, string> = {
  MANUAL: "Only when I click Run now",
  SCHEDULE: "On a repeating schedule",
  ONCE: "Once, at a date and time",
};

export type SchedulePatch = {
  trigger: UserTrigger;
  cron: string | null;
  timezone: string | null;
  runAt: string | null;
  isEnabled: boolean;
};

const pad = (value: number) => String(value).padStart(2, "0");

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
  const fired = hasFired(schedule);
  // A cron the plain controls cannot express; kept unless the user replaces it.
  const custom =
    schedule.cron && !parseSimpleCron(schedule.cron) ? schedule.cron : null;

  const [mode, setMode] = useState<UserTrigger>(
    isUserTrigger(schedule.trigger) ? schedule.trigger : "MANUAL",
  );
  const [cron, setCron] = useState<SimpleCron>(
    (schedule.cron && parseSimpleCron(schedule.cron)) || DEFAULT_CRON,
  );
  const [keepCustom, setKeepCustom] = useState(custom !== null);
  const [runAtLocal, setRunAtLocal] = useState(() =>
    toLocalInput(
      schedule.trigger === "ONCE" && schedule.runAt && !fired
        ? new Date(schedule.runAt)
        : nextFullHour(),
    ),
  );
  // Workflows are created off; saving a new schedule is what turns one on.
  const [enabled, setEnabled] = useState(
    schedule.trigger === "MANUAL" || fired ? true : schedule.isEnabled,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A recurring schedule keeps its saved zone; a one-off uses the browser's.
  const zone =
    mode === "SCHEDULE" && schedule.trigger === "SCHEDULE" && schedule.timezone
      ? schedule.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;

  const cronText = keepCustom && custom ? custom : buildCron(cron);
  const noDays = !keepCustom && cron.repeat === "days" && cron.days.length === 0;

  function update(patch: Partial<SimpleCron>) {
    setCron((current) => ({ ...current, ...patch }));
  }

  function toggleDay(day: number) {
    update({
      days: cron.days.includes(day)
        ? cron.days.filter((value) => value !== day)
        : [...cron.days, day],
    });
  }

  function buildPatch():
    | { ok: true; patch: SchedulePatch }
    | { ok: false; error: string } {
    if (mode === "MANUAL") {
      return {
        ok: true,
        patch: { trigger: mode, cron: null, timezone: null, runAt: null, isEnabled: false },
      };
    }
    if (mode === "SCHEDULE") {
      if (noDays) return { ok: false, error: "Pick at least one day." };
      return {
        ok: true,
        patch: { trigger: mode, cron: cronText, timezone: zone, runAt: null, isEnabled: enabled },
      };
    }
    // datetime-local has no zone, so Date reads it as local time.
    const runAt = new Date(runAtLocal);
    if (Number.isNaN(runAt.getTime())) return { ok: false, error: "Pick a date and time." };
    return {
      ok: true,
      patch: {
        trigger: mode,
        cron: null,
        timezone: zone,
        runAt: runAt.toISOString(),
        isEnabled: enabled,
      },
    };
  }

  async function save() {
    const built = buildPatch();
    setSaved(false);
    if (!built.ok) {
      setError(built.error);
      return;
    }

    setSaving(true);
    setError(null);
    const failure = await onSave(built.patch);
    setSaving(false);
    if (failure) setError(failure);
    else setSaved(true);
  }

  return (
    <InspectorPanel
      eyebrow="Trigger"
      title="When this workflow runs"
      closeLabel="Close schedule"
      onClose={onClose}
      footer={
        <button
          type="button"
          className={`${primaryButtonClass} w-full`}
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
      }
    >
      {schedule.trigger === "WEBHOOK" ? (
        <p className={`mb-3 ${hintClass}`}>
          This workflow runs from a webhook. Saving a schedule here replaces it.
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-1.5">
        <legend className={labelClass}>Runs</legend>
        {USER_TRIGGERS.map((value) => (
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
            {MODE_LABELS[value]}
          </label>
        ))}
      </fieldset>

      {mode === "SCHEDULE" ? (
        <section className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
          <div>
            <label className={labelClass} htmlFor="schedule-repeat">
              Repeat
            </label>
            <select
              id="schedule-repeat"
              className={`${fieldClass} mt-1`}
              value={keepCustom ? "custom" : cron.repeat}
              onChange={(event) => {
                const value = event.target.value;
                setKeepCustom(value === "custom");
                if (value !== "custom") update({ repeat: value as SimpleCron["repeat"] });
              }}
            >
              <option value="hourly">Every hour</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="days">On certain days of the week</option>
              <option value="monthly">Every month</option>
              {custom ? (
                <option value="custom">Keep the current custom schedule</option>
              ) : null}
            </select>
          </div>

          {!keepCustom && cron.repeat === "days" ? (
            <fieldset>
              <legend className={labelClass}>On</legend>
              <div className="mt-1 flex flex-wrap gap-1">
                {WEEK.map((day) => {
                  const active = cron.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      className={`h-7 w-10 cursor-pointer rounded-full border text-xs ${
                        active
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-border text-foreground hover:bg-accent"
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

          {!keepCustom && cron.repeat === "monthly" ? (
            <div>
              <label className={labelClass} htmlFor="schedule-day-of-month">
                On day
              </label>
              <select
                id="schedule-day-of-month"
                className={`${fieldClass} mt-1`}
                value={cron.dayOfMonth}
                onChange={(event) => update({ dayOfMonth: Number(event.target.value) })}
              >
                {range(1, 31).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {cron.dayOfMonth > 28 ? (
                <p className={`mt-1 ${hintClass}`}>
                  Months without a {ordinal(cron.dayOfMonth)} are skipped.
                </p>
              ) : null}
            </div>
          ) : null}

          {keepCustom ? null : cron.repeat === "hourly" ? (
            <div>
              <label className={labelClass} htmlFor="schedule-minute">
                At minutes past the hour
              </label>
              <select
                id="schedule-minute"
                className={`${fieldClass} mt-1`}
                value={cron.minute}
                onChange={(event) => update({ minute: Number(event.target.value) })}
              >
                {range(0, 59).map((minute) => (
                  <option key={minute} value={minute}>
                    :{pad(minute)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className={labelClass} htmlFor="schedule-time">
                At
              </label>
              <input
                id="schedule-time"
                type="time"
                className={`${fieldClass} mt-1`}
                value={`${pad(cron.hour)}:${pad(cron.minute)}`}
                onChange={(event) => {
                  const [hour, minute] = event.target.value.split(":").map(Number);
                  if (!Number.isNaN(hour) && !Number.isNaN(minute)) update({ hour, minute });
                }}
              />
            </div>
          )}

          {/* Read back in words to confirm what will be saved. */}
          <p className="rounded-lg bg-muted px-2 py-1.5 text-xs text-foreground">
            {noDays ? "Pick at least one day." : describeSchedule(cronText, zone)}
          </p>
        </section>
      ) : null}

      {mode === "ONCE" ? (
        <section className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
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
            <p className={hintClass}>This already ran. Pick a new time to run it again.</p>
          ) : null}
        </section>
      ) : null}

      {mode !== "MANUAL" ? (
        <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-border pt-3 text-sm">
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

      {error ? <p className={`mt-3 ${errorClass}`}>{error}</p> : null}
      {saved ? <p className={`mt-3 ${hintClass}`}>Saved.</p> : null}
    </InspectorPanel>
  );
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** The value a datetime-local input expects, in the browser's zone. */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function nextFullHour(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}
