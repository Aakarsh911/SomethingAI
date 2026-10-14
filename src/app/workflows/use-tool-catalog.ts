"use client";

import { useEffect, useState } from "react";
import type { ServerTool } from "@/app/api/tools/[serverSlug]/route";

/**
 * One request per server per page load. The in-flight promise is cached
 * because the inspector remounts on every selection; failures are evicted.
 */
const cache = new Map<string, Promise<ServerTool[]>>();

function loadTools(serverSlug: string): Promise<ServerTool[]> {
  let pending = cache.get(serverSlug);
  if (!pending) {
    pending = fetch(`/api/tools/${encodeURIComponent(serverSlug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the tool list.");
        return ((await response.json()) as { tools: ServerTool[] }).tools;
      })
      .catch((error: unknown) => {
        cache.delete(serverSlug);
        throw error;
      });
    cache.set(serverSlug, pending);
  }
  return pending;
}

export type ToolsState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; tools: ServerTool[] };

/** Results are keyed by server, so a new slug never shows the old server's tools. */
export function useServerTools(serverSlug: string | undefined): ToolsState {
  const [result, setResult] = useState<{ serverSlug: string; state: ToolsState } | null>(
    null,
  );

  useEffect(() => {
    if (!serverSlug) return;
    let active = true;
    loadTools(serverSlug).then(
      (tools) => {
        if (active) setResult({ serverSlug, state: { status: "ready", tools } });
      },
      (error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Could not load tools.";
        setResult({ serverSlug, state: { status: "error", error: message } });
      },
    );
    return () => {
      active = false;
    };
  }, [serverSlug]);

  if (!serverSlug) return { status: "ready", tools: [] };
  return result?.serverSlug === serverSlug ? result.state : { status: "loading" };
}
