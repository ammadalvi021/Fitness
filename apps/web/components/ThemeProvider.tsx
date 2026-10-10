"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "ff-theme";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}>({ theme: "light", setTheme: () => {}, toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Theme provider: toggles the `dark` class on <html>.
 * The initial value is applied by the inline no-flash script in the root
 * layout; this component syncs React state with that value and persists
 * changes to localStorage under "ff-theme".
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Read whatever the inline script already applied.
    const isDark = document.documentElement.classList.contains("dark");
    setThemeState(isDark ? "dark" : "light");
    setReady(true);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Storage unavailable; theme still applies for this session.
    }
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  // Render children immediately; theme class is already correct from the
  // inline script, so there is no flash regardless of `ready`.
  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Inline script (string) injected into the root layout <head> to apply the
 * stored theme before first paint — no flash of the wrong theme.
 * Uses the same storage key as ThemeProvider.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var d=s==='dark'||(!s&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
