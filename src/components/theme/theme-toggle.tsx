"use client";

import { useLayoutEffect } from "react";
import SwitchButton from "@/components/kokonutui/switch-button";
import { setThemePreference, syncThemeFromStorage, useResolvedTheme } from "./theme";

export function ThemeToggle({
  size = "sm",
  showLabel = false,
  className,
}: {
  size?: "sm" | "default" | "lg";
  showLabel?: boolean;
  className?: string;
}) {
  const theme = useResolvedTheme();

  useLayoutEffect(() => {
    syncThemeFromStorage();
  }, []);

  return (
    <SwitchButton
      size={size}
      showLabel={showLabel}
      className={className}
      theme={theme}
      onThemeChange={setThemePreference}
      title="Toggle theme"
    />
  );
}
