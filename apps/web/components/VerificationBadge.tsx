"use client";

import { BadgeCheck, FlaskConical } from "lucide-react";

/**
 * VerificationBadge — honest data-source indicator for nutrition values.
 *
 * - `verified`: value comes from a real source (restaurant-published,
 *   lab analysis, official label). Green.
 * - `estimate`: value is an estimate (generic equivalent, recipe
 *   assumption, AI estimate). Amber, with the basis as tooltip text.
 *
 * Every food/product/menu item that shows nutrition MUST render this.
 */
export function VerificationBadge({
  verification,
  basis,
  className = "",
}: {
  verification: "estimate" | "verified" | string;
  basis?: string | null;
  className?: string;
}) {
  const isVerified = verification === "verified";
  const Icon = isVerified ? BadgeCheck : FlaskConical;
  const label = isVerified ? "Verified" : "Estimate";
  const title = isVerified
    ? "Verified value from a real source"
    : basis
      ? `Estimate — basis: ${basis}`
      : "Estimate — treat as a rough guide";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        borderColor: isVerified
          ? "color-mix(in srgb, var(--success) 45%, transparent)"
          : "color-mix(in srgb, var(--warning) 45%, transparent)",
        backgroundColor: isVerified
          ? "color-mix(in srgb, var(--success) 12%, transparent)"
          : "color-mix(in srgb, var(--warning) 12%, transparent)",
        color: "var(--text)",
      }}
      title={title}
      aria-label={title}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
