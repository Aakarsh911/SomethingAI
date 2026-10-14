"use client";

import { createContext } from "react";
import {
  describeRunAt,
  describeSchedule,
  type WorkflowSchedule,
} from "@/lib/workflows/schedule";

/**
 * The schedule lives on the Workflow row, not in the graph, so the trigger
 * card reads it from context and editing it never adds a graph version.
 */
export const ScheduleContext = createContext<WorkflowSchedule | null>(null);

/** True for a one-off the worker switched off after it fired. */
export function hasFired(schedule: WorkflowSchedule): boolean {
  return (
    schedule.trigger === "ONCE" &&
    !schedule.isEnabled &&
    schedule.runAt !== null &&
    schedule.lastRunAt !== null &&
    new Date(schedule.lastRunAt).getTime() >= new Date(schedule.runAt).getTime()
  );
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
    const fired = hasFired(schedule);
    return {
      text: `${fired ? "Ran" : "Once"} on ${describeRunAt(new Date(schedule.runAt), schedule.timezone)}`,
      off: !schedule.isEnabled && !fired,
    };
  }

  return { text: "Only when you click Run now", off: false };
}
