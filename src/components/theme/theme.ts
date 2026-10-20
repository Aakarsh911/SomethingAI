"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "./theme-constants";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
  }
  return "system";
}

export function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this page view.
  }
  applyTheme(preference === "system" ? systemTheme() : preference);
}

/** Re-applies the stored theme; React's dev remount clears the class the head script set. */
export function syncThemeFromStorage() {
  const preference = readPreference();
  applyTheme(preference === "system" ? systemTheme() : preference);
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (readPreference() === "system") applyTheme(systemTheme());
  };
  media.addEventListener("change", onSystemChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onSystemChange);
  };
}

function snapshot(): ResolvedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The theme actually on screen. The server always reports light. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, snapshot, () => "light");
}
