"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Theme model                                                         */
/* ------------------------------------------------------------------ */

/** All selectable themes. `system` resolves at runtime to a dark or light
 *  luxury variant (obsidian-gold / light-luxe) — it is never a token set. */
export type Theme =
  | "obsidian-gold"
  | "midnight-emerald"
  | "slate-silver"
  | "light-luxe"
  | "system";

/** The concrete themes that render (system always resolves to one of these). */
export type ResolvedTheme = Exclude<Theme, "system">;

export const THEMES: readonly Theme[] = [
  "obsidian-gold",
  "midnight-emerald",
  "slate-silver",
  "light-luxe",
  "system",
] as const;

export const THEME_LABELS: Record<Theme, string> = {
  "obsidian-gold": "Obsidian Gold",
  "midnight-emerald": "Midnight Emerald",
  "slate-silver": "Slate Silver",
  "light-luxe": "Light Luxe",
  system: "System (auto)",
};

/** Themes that render with the `dark` class (keeps `dark:` variants working). */
export const DARK_THEMES: ReadonlySet<ResolvedTheme> = new Set([
  "obsidian-gold",
  "midnight-emerald",
  "slate-silver",
]);

export const DEFAULT_THEME: ResolvedTheme = "obsidian-gold";

const STORAGE_KEY = "ff-theme";

function isTheme(value: string | null | undefined): value is Theme {
  return value === "obsidian-gold" ||
    value === "midnight-emerald" ||
    value === "slate-silver" ||
    value === "light-luxe" ||
    value === "system";
}

/** Validate a stored value; unknown/missing falls back to the default. */
export function parseStoredTheme(
  stored: string | null | undefined
): Theme {
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/**
 * Pure-logic theme resolution (no DOM): given the stored preference and the
 * device's color-scheme preference, return the concrete theme to render.
 *   - unknown/invalid stored value → obsidian-gold (new default)
 *   - "system" + dark device → obsidian-gold
 *   - "system" + light device → light-luxe
 */
export function resolveTheme(
  stored: string | null | undefined,
  prefersDark: boolean
): ResolvedTheme {
  const theme = parseStoredTheme(stored);
  if (theme === "system") {
    return prefersDark ? "obsidian-gold" : "light-luxe";
  }
  return theme;
}

/** Whether a concrete theme renders as dark (drives the `dark` class). */
export function isDarkTheme(theme: ResolvedTheme): boolean {
  return DARK_THEMES.has(theme);
}

/** Apply a resolved theme to <html>: data-theme + dark class. */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.classList.toggle("dark", isDarkTheme(theme));
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

const ThemeContext = createContext<{
  theme: Theme;
  /** The concrete theme actually rendered (system already resolved). */
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}>({
  theme: DEFAULT_THEME,
  resolvedTheme: DEFAULT_THEME,
  setTheme: () => {},
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Theme provider: keeps React state in sync with the no-flash script,
 * persists to localStorage under "ff-theme", and re-resolves when the OS
 * color scheme changes while theme === "system".
 *
 * No hydration errors: the initial value is read from documentElement in
 * useEffect (the pattern the inline script already applied), and children
 * render immediately — there is no flash regardless.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] =
    useState<ResolvedTheme>(DEFAULT_THEME);
  const themeRef = useRef<Theme>(DEFAULT_THEME);

  const resolveAndApply = (t: Theme) => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const resolved = resolveTheme(t, mq.matches);
    applyResolvedTheme(resolved);
    setResolvedTheme(resolved);
  };

  useEffect(() => {
    // Read whatever the inline script already applied.
    let stored: Theme = DEFAULT_THEME;
    try {
      stored = parseStoredTheme(localStorage.getItem(STORAGE_KEY));
    } catch {
      // Storage unavailable; keep the default for this session.
    }
    themeRef.current = stored;
    setThemeState(stored);
    resolveAndApply(stored);

    // Re-resolve if the OS scheme changes while following the system.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (themeRef.current === "system") {
        resolveAndApply("system");
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = (t: Theme) => {
    themeRef.current = t;
    setThemeState(t);
    resolveAndApply(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Storage unavailable; theme still applies for this session.
    }
  };

  /** Cycle through all five themes (backward-compatible toggle). */
  const toggle = () => {
    const idx = THEMES.indexOf(themeRef.current);
    setTheme(THEMES[(idx + 1) % THEMES.length]);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Inline script (string) injected into the root layout <head> to apply the
 * stored theme before first paint — no flash of the wrong theme.
 * Uses the same storage key as ThemeProvider.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var v=['obsidian-gold','midnight-emerald','slate-silver','light-luxe','system'];var t=v.indexOf(s)>=0?s:'obsidian-gold';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'obsidian-gold':'light-luxe'):t;var d=document.documentElement;d.dataset.theme=r;d.classList.toggle('dark',r!=='light-luxe');}catch(e){try{document.documentElement.dataset.theme='obsidian-gold';}catch(_){}}})();`;
