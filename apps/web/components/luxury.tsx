/**
 * FitFusion AI — luxury component library.
 *
 * Built on the design tokens in globals.css (`--bg`, `--bg-elevated`,
 * `--accent`, `--text`, …) so every theme (obsidian-gold, midnight-emerald,
 * slate-silver, light-luxe) restyles them automatically.
 *
 * Rules followed here:
 * - Accent color is used for borders, icons and large numerals — never for
 *   small body text on light themes (contrast would fail).
 * - No neon glow, no heavy blur: translucent surfaces + thin borders +
 *   soft shadows only.
 * - Motion is gated behind `prefers-reduced-motion` in globals.css.
 */

import type { CSSProperties, ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Modal } from "./ui";

/* ------------------------------------------------------------------ */
/* GlassPanel — translucent elevated surface                           */
/* ------------------------------------------------------------------ */

export function GlassPanel({
  children,
  className = "",
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl backdrop-blur-sm ${className}`}
      style={{
        backgroundColor: "color-mix(in srgb, var(--bg-elevated) 78%, transparent)",
        border: "1px solid var(--border)",
        boxShadow: "0 12px 32px -16px rgba(0, 0, 0, 0.5)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MetricCard — label, value, delta/subtext, icon slot                  */
/* ------------------------------------------------------------------ */

type DeltaTone = "up" | "down" | "neutral";

const deltaToneColor: Record<DeltaTone, string> = {
  up: "var(--success)",
  down: "var(--error)",
  neutral: "var(--text-secondary)",
};

export function MetricCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  subtext,
  icon,
  className = "",
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaTone?: DeltaTone;
  subtext?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const DeltaIcon =
    deltaTone === "up" ? TrendingUp : deltaTone === "down" ? TrendingDown : Minus;
  return (
    <GlassPanel className={`anim-hover-lift p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="t-meta">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{
              color: "var(--accent)",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="t-numeral mt-2 text-3xl">{value}</p>
      {(delta || subtext) && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          {delta && (
            <span
              className="inline-flex items-center gap-1 font-medium"
              style={{ color: deltaToneColor[deltaTone] }}
            >
              <DeltaIcon size={15} aria-hidden="true" />
              {delta}
            </span>
          )}
          {subtext && (
            <span style={{ color: "var(--text-secondary)" }}>{subtext}</span>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/* ProgressRing — SVG ring with accent stroke                           */
/* ------------------------------------------------------------------ */

export function ProgressRing({
  value,
  size = 96,
  strokeWidth = 8,
  label,
  showValue = true,
  className = "",
}: {
  /** 0–100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={`inline-flex flex-col items-center gap-2 ${className}`}
      role="img"
      aria-label={label ? `${label}: ${Math.round(clamped)}%` : `${Math.round(clamped)}%`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            style={{ stroke: "var(--bg-secondary)" }}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ stroke: "var(--accent)", transition: "stroke-dashoffset 300ms ease-out" }}
          />
        </svg>
        {showValue && (
          <span
            className="t-numeral absolute inset-0 flex items-center justify-center text-xl"
            aria-hidden="true"
          >
            {Math.round(clamped)}%
          </span>
        )}
      </div>
      {label && (
        <span className="t-meta text-center" style={{ maxWidth: size }}>
          {label}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ProgressBar — slim accent bar                                        */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  value,
  max = 100,
  label,
  className = "",
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="t-meta">{label}</span>
          <span className="t-numeral text-sm">{Math.round(pct)}%</span>
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--bg-secondary)" }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: "var(--accent)",
            transition: "width 300ms ease-out",
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LuxButton — primary (accent) / secondary (outline) / ghost           */
/* ------------------------------------------------------------------ */

type LuxButtonVariant = "primary" | "secondary" | "ghost";

export function LuxButton({
  variant = "primary",
  className = "",
  children,
  ...rest
}: {
  variant?: LuxButtonVariant;
  className?: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "anim-press touch-target inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-base font-medium transition-colors active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60";
  const styles: CSSProperties =
    variant === "primary"
      ? {
          backgroundColor: "var(--accent)",
          color: "var(--on-accent)",
        }
      : variant === "secondary"
        ? {
            backgroundColor: "transparent",
            color: "var(--text)",
            border: "1px solid var(--accent)",
          }
        : {
            backgroundColor: "transparent",
            color: "var(--text-secondary)",
          };
  return (
    <button type="button" className={`${base} ${className}`} style={styles} {...rest}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* LuxBadge — tinted pill with tone dot                                 */
/* ------------------------------------------------------------------ */

type LuxBadgeTone = "accent" | "success" | "warning" | "error" | "neutral";

const badgeToneVar: Record<LuxBadgeTone, string> = {
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
  neutral: "var(--text-secondary)",
};

export function LuxBadge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: LuxBadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const toneColor = badgeToneVar[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${className}`}
      style={{
        color: "var(--text)",
        backgroundColor: `color-mix(in srgb, ${toneColor} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${toneColor} 38%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: toneColor }}
      />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip — CSS-only, shows on hover/focus of the trigger              */
/* ------------------------------------------------------------------ */

export function Tooltip({
  tip,
  children,
  className = "",
}: {
  tip: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          color: "var(--text)",
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 24px -8px rgba(0, 0, 0, 0.5)",
        }}
      >
        {tip}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* LuxDialog — luxury-skinned wrapper around the existing Modal.        */
/* Modal's focus/Escape logic is reused, not forked.                    */
/* ------------------------------------------------------------------ */

export function LuxDialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="t-body">{children}</div>
      {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyStateLux / ErrorStateLux                                        */
/* ------------------------------------------------------------------ */

export function EmptyStateLux({
  icon,
  title,
  message,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <GlassPanel className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      {icon && (
        <span
          aria-hidden="true"
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            color: "var(--accent)",
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {icon}
        </span>
      )}
      <h3 className="t-card-heading">{title}</h3>
      {message && (
        <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--text-secondary)" }}>
          {message}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </GlassPanel>
  );
}

export function ErrorStateLux({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  className = "",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <GlassPanel className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      <span
        aria-hidden="true"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{
          color: "var(--error)",
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        <AlertTriangle size={22} />
      </span>
      <h3 className="t-card-heading">{title}</h3>
      {message && (
        <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--text-secondary)" }}>
          {message}
        </p>
      )}
      {onRetry && (
        <div className="mt-5">
          <LuxButton variant="secondary" onClick={onRetry}>
            {retryLabel}
          </LuxButton>
        </div>
      )}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/* PlanCard — premium plan display                                      */
/* ------------------------------------------------------------------ */

export function PlanCard({
  name,
  price,
  period,
  features,
  highlighted = false,
  badge,
  cta,
  className = "",
}: {
  name: string;
  price: ReactNode;
  period?: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
  cta?: ReactNode;
  className?: string;
}) {
  return (
    <GlassPanel
      className={`anim-hover-lift relative flex flex-col p-6 ${className}`}
      style={
        highlighted
          ? { border: "1px solid var(--accent)", boxShadow: "0 16px 40px -16px rgba(0, 0, 0, 0.55)" }
          : undefined
      }
    >
      {badge && (
        <div className="absolute -top-3 left-6">
          <LuxBadge tone="accent">{badge}</LuxBadge>
        </div>
      )}
      <h3 className="t-card-heading">{name}</h3>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="t-numeral text-4xl">{price}</span>
        {period && (
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {period}
          </span>
        )}
      </p>
      <ul className="mt-5 flex flex-col gap-2.5 text-sm" style={{ color: "var(--text)" }}>
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {cta && <div className="mt-6 pt-2">{cta}</div>}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/* MediaPanelLux — shell for exercise media (video/animation)          */
/* ------------------------------------------------------------------ */

export function MediaPanelLux({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-2xl ${className}`}
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex h-full w-full items-center justify-center">{children}</div>
      {label && (
        <span
          className="absolute bottom-3 left-3 rounded-lg px-2.5 py-1 text-xs font-medium"
          style={{
            color: "var(--text)",
            backgroundColor: "color-mix(in srgb, var(--bg-elevated) 82%, transparent)",
            border: "1px solid var(--border)",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
