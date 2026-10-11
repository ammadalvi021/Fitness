"use client";

import { Palette } from "lucide-react";
import { THEMES, THEME_LABELS, useTheme } from "./ThemeProvider";
import type { Theme } from "./ThemeProvider";

/**
 * ThemeSelector — a labeled theme picker listing all five themes with
 * friendly names. Drop it into Settings, nav, or any preferences surface.
 * 44px minimum touch target, fully keyboard accessible (native <select>).
 *
 * `compact` renders an icon-only cycle button (Palette) for tight surfaces
 * like the desktop sidebar footer. Tooltip + aria-label name the action;
 * pressing Enter/Space cycles to the next theme.
 */
export function ThemeSelector({
  id = "theme-selector",
  label = "Theme",
  className = "",
  compact = false,
}: {
  id?: string;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const { theme, setTheme, toggle } = useTheme();

  if (compact) {
    const tip = `Theme: ${THEME_LABELS[theme]} — cycle to next`;
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={tip}
        title={tip}
        className="touch-target flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)]"
      >
        <Palette size={20} aria-hidden="true" />
      </button>
    );
  }


  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium"
        style={{ color: "var(--text)" }}
      >
        {label}
      </label>
      <select
        id={id}
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
        className="touch-target w-full rounded-xl border px-4 py-2.5 text-base focus-visible:outline-none"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--bg-elevated)",
          color: "var(--text)",
        }}
      >
        {THEMES.map((t) => (
          <option key={t} value={t}>
            {THEME_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );
}
