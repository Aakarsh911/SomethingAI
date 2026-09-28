"use client";

import { createContext } from "react";
import { describeRunAt, describeSchedule } from "@/lib/workflows/schedule";

/**
 * A workflow's schedule as the studio sees it.
 *
 * It lives on the Workflow row rather than in the graph, so it does not ride
 * through the canvas's node data. The trigger card reads it from context
 * instead, which keeps a schedule change from rewriting the graph or adding a
 * version.
 */
export type WorkflowSchedule = {
  trigger: "MANUAL" | "SCHEDULE" | "WEBHOOK" | "ONCE";
  isEnabled: boolean;
  cron: string | null;
  timezone: string | null;
  /** ISO instants, as they arrive from the API. */
  runAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export const ScheduleContext = createContext<WorkflowSchedule | null>(null);

/** The schedule fields off a larger API response, so the rest is not kept. */
export function pickSchedule(value: WorkflowSchedule): WorkflowSchedule {
  return {
    trigger: value.trigger,
    isEnabled: value.isEnabled,
    cron: value.cron,
    timezone: value.timezone,
    runAt: value.runAt,
    nextRunAt: value.nextRunAt,
    lastRunAt: value.lastRunAt,
  };
}

/** One line for the trigger card, e.g. "Every Monday at 09:00 (…) · Off". */
export function summarizeSchedule(schedule: WorkflowSchedule): {
  text: string;
  off: boolean;
} {
  if (schedule.trigger === "SCHEDULE" && schedule.cron && schedule.timezone) {
    return {
      text: describeSchedule(schedule.cron, schedule.timezone),
      off: !schedule.isEnabled,
    };
  }

  if (schedule.trigger === "ONCE" && schedule.runAt && schedule.timezone) {
    const runAt = new Date(schedule.runAt);
    const text = describeRunAt(runAt, schedule.timezone);
    // Switched off by the worker after firing, as opposed to never switched on.
    const fired =
      !schedule.isEnabled &&
      schedule.lastRunAt !== null &&
      new Date(schedule.lastRunAt).getTime() >= runAt.getTime();
    return {
      text: fired ? text.replace(/^Once on/, "Ran on") : text,
      off: !schedule.isEnabled && !fired,
    };
  }

  return { text: "Only when you click Run now", off: false };
}
