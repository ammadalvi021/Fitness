/**
 * Central branding configuration for FitFusion AI.
 * Change the name, logo, tagline, and colors here (or via the
 * NEXT_PUBLIC_* env overrides) to rebrand the whole app.
 *
 * NOTE: only NEXT_PUBLIC_ variables may be read by client components.
 * Never put secrets in this file.
 */

export interface BrandColors {
  /** Primary brand color (buttons, active nav, progress rings) */
  primary: string;
  /** Darker shade of primary for hover states */
  primaryDark: string;
  /** Accent color for highlights, charts, streaks */
  accent: string;
  /** Success / healthy-choice color */
  success: string;
  /** Warning color */
  warning: string;
  /** Danger / destructive color */
  danger: string;
}

export interface Branding {
  appName: string;
  tagline: string;
  /** Path to logo under /public (SVG preferred) */
  logoPath: string;
  /** Path to a monochrome mark for the PWA icon mask */
  iconPath: string;
  colors: BrandColors;
}

function env(name: string, fallback: string): string {
  if (typeof process !== "undefined" && process.env && process.env[name]) {
    return process.env[name] as string;
  }
  return fallback;
}

export const branding: Branding = {
  appName: env("NEXT_PUBLIC_APP_NAME", "FitFusion AI"),
  tagline: env(
    "NEXT_PUBLIC_APP_TAGLINE",
    "Train smart. Eat well. Live strong."
  ),
  logoPath: env("NEXT_PUBLIC_APP_LOGO", "/brand/logo.svg"),
  iconPath: env("NEXT_PUBLIC_APP_ICON", "/brand/icon.svg"),
  colors: {
    primary: env("NEXT_PUBLIC_BRAND_PRIMARY", "#16a34a"),
    primaryDark: env("NEXT_PUBLIC_BRAND_PRIMARY_DARK", "#15803d"),
    accent: env("NEXT_PUBLIC_BRAND_ACCENT", "#f59e0b"),
    success: env("NEXT_PUBLIC_BRAND_SUCCESS", "#22c55e"),
    warning: env("NEXT_PUBLIC_BRAND_WARNING", "#f59e0b"),
    danger: env("NEXT_PUBLIC_BRAND_DANGER", "#ef4444"),
  },
};

/**
 * Tailwind-friendly CSS variable injection.
 * The web app sets these as CSS custom properties on :root so the
 * whole UI can be recolored without rebuilding component code.
 */
export function brandingCssVariables(): Record<string, string> {
  return {
    "--brand-primary": branding.colors.primary,
    "--brand-primary-dark": branding.colors.primaryDark,
    "--brand-accent": branding.colors.accent,
    "--brand-success": branding.colors.success,
    "--brand-warning": branding.colors.warning,
    "--brand-danger": branding.colors.danger,
  };
}
