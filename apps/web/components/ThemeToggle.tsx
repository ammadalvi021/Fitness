"use client";

import { Moon, Sun } from "lucide-react";
import { isDarkTheme, useTheme } from "./ThemeProvider";

/** Theme cycle button: steps through all five themes (44px touch target). */
export function ThemeToggle() {
  const { resolvedTheme, toggle } = useTheme();
  const isDark = isDarkTheme(resolvedTheme);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "Cycle to next theme (currently dark)" : "Cycle to next theme (currently light)"}
      title="Cycle theme"
      className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
      style={{ color: "var(--text-secondary)" }}
    >
      {isDark ? (
        <Sun size={20} aria-hidden="true" />
      ) : (
        <Moon size={20} aria-hidden="true" />
      )}
    </button>
  );
}
