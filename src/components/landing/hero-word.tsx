"use client";

import DynamicText from "@/components/kokonutui/dynamic-text";

const TOOLS = ["Gmail", "GitHub", "Slack", "Notion", "Linear", "Calendar"];

export function HeroWord() {
  return (
    <DynamicText
      words={TOOLS}
      interval={2000}
      className="text-brand [--dynamic-text-accent:var(--brand)] dark:[--dynamic-text-accent:var(--brand)]"
    />
  );
}
