/**
 * V20 Feature 7 — theme → canvas palette map.
 *
 * Canvas 2D can't read the CSS custom properties that drive the luxury
 * themes (`--bg`, `--accent`, … under `data-theme`), so this small map
 * mirrors the concrete token values from `app/globals.css`. Only the
 * concrete themes are keys: `system` always resolves to one of these at
 * render time (see components/ThemeProvider.tsx).
 */

import type { ResolvedTheme } from "./ThemeProvider";

export interface CardPalette {
  /** Card background. */
  bg: string;
  /** Slightly lifted panel tone for bands/accents. */
  elevated: string;
  /** Primary accent (gold/emerald/silver per theme). */
  accent: string;
  /** Muted accent for lines, rings, sparkline fill. */
  accentMuted: string;
  /** Primary text. */
  text: string;
  /** Secondary text. */
  textSecondary: string;
}

export const CARD_PALETTES: Record<ResolvedTheme, CardPalette> = {
  "obsidian-gold": {
    bg: "#090b0f",
    elevated: "#11151c",
    accent: "#d6b36a",
    accentMuted: "#a98745",
    text: "#f5f2ea",
    textSecondary: "#a8b0bc",
  },
  "obsidian-gold-light": {
    bg: "#faf8f3",
    elevated: "#ffffff",
    accent: "#a98745",
    accentMuted: "#7a6234",
    text: "#1c1b18",
    textSecondary: "#5c5a54",
  },
  "midnight-emerald": {
    bg: "#0a0f0c",
    elevated: "#0f1512",
    accent: "#34d399",
    accentMuted: "#1e8f68",
    text: "#eef4f1",
    textSecondary: "#a3b3ac",
  },
  "midnight-emerald-light": {
    bg: "#f4faf7",
    elevated: "#ffffff",
    accent: "#0e7a55",
    accentMuted: "#0a5c40",
    text: "#121915",
    textSecondary: "#4e5d55",
  },
  "slate-silver": {
    bg: "#0f1216",
    elevated: "#161b21",
    accent: "#c0c7d1",
    accentMuted: "#8b95a3",
    text: "#f2f4f7",
    textSecondary: "#a8b0bc",
  },
  "slate-silver-light": {
    bg: "#f7f8fa",
    elevated: "#ffffff",
    accent: "#5b6b7f",
    accentMuted: "#46536a",
    text: "#15181d",
    textSecondary: "#4e5866",
  },
  "light-luxe": {
    bg: "#faf8f3",
    elevated: "#ffffff",
    accent: "#a98745",
    accentMuted: "#7a6234",
    text: "#1c1b18",
    textSecondary: "#5c5a54",
  },
};

/** Default to obsidian-gold when the theme is unknown. */
export function paletteForTheme(theme: string | null | undefined): CardPalette {
  if (
    theme === "obsidian-gold" ||
    theme === "obsidian-gold-light" ||
    theme === "midnight-emerald" ||
    theme === "midnight-emerald-light" ||
    theme === "slate-silver" ||
    theme === "slate-silver-light" ||
    theme === "light-luxe"
  ) {
    return CARD_PALETTES[theme];
  }
  return CARD_PALETTES["obsidian-gold"];
}
