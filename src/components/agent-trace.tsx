"use client";

import { useEffect, useState } from "react";
import AILoadingState, {
  type AgentStep,
} from "@/components/kokonutui/ai-loading";

type TraceStep = Omit<AgentStep, "status">;

const GENERATE: TraceStep[] = [
  {
    id: "tools",
    label: "Reading your tools",
    detail: ["Listing connected accounts", "Checking which tools can run"],
  },
  {
    id: "steps",
    label: "Choosing the steps",
    detail: ["Matching the request to a tool", "Ordering trigger, tools, and model"],
  },
  {
    id: "graph",
    label: "Drafting the graph",
    detail: ["Writing the schedule", "Checking arguments"],
  },
];

const MODIFY: TraceStep[] = [
  {
    id: "read",
    label: "Reading the graph",
    detail: ["Loading the saved version", "Finding the steps this change touches"],
  },
  {
    id: "rewire",
    label: "Rewiring the steps",
    detail: ["Applying the instruction", "Keeping steps you did not mention"],
  },
  {
    id: "save",
    label: "Saving a new version",
    detail: ["Writing the graph", "Keeping the previous version"],
  },
];

/** Kokonut's agent step list, driven while a generate or modify request is in flight. */
export function AgentTrace({
  active,
  preset,
}: {
  active: boolean;
  preset: "generate" | "modify";
}) {
  const catalog = preset === "modify" ? MODIFY : GENERATE;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setTick((current) => Math.min(current + 1, catalog.length - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, catalog]);

  const steps: AgentStep[] = catalog.map((step, index) => ({
    ...step,
    status: !active ? "done" : index < tick ? "done" : index === tick ? "running" : "pending",
  }));

  return (
    <AILoadingState
      steps={steps}
      collapseWhenDone
      className="justify-start"
    />
  );
}
