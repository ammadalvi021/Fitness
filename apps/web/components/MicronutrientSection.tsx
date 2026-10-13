"use client";

/**
 * MicronutrientSection — Cronometer-style %DV display for a day's diary.
 *
 * Honesty rules (binding):
 * - A micro with no data anywhere in the day renders "Not tracked" —
 *   never 0, never a 0% bar.
 * - Tracked values are estimates from USDA FoodData Central where the
 *   source food reported them (VerificationBadge pattern, section-level).
 * - %DV is against FDA reference Daily Values (21 CFR 101.36), a single
 *   population reference — not personalized advice.
 */
import { Info } from "lucide-react";
import { GlassPanel, Tooltip } from "@/components/luxury";
import {
  DAILY_VALUES,
  MICRO_KEYS,
  formatMicroAmount,
  pctDailyValue,
  trackedMicroKeys,
  type MicroKey,
  type MicroNutrients,
} from "@/lib/daily-values";

function MicroRow({ microKey, totals }: { microKey: MicroKey; totals: MicroNutrients }) {
  const dv = DAILY_VALUES[microKey];
  const v = totals[microKey];
  const pct = v ? pctDailyValue(microKey, v.amount) : null;
  const tracked = v != null && pct != null;
  const barPct = tracked ? Math.min(pct, 100) : 0;

  return (
    <div className="py-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="t-body text-sm font-medium">{dv.label}</span>
        {tracked ? (
          <span className="t-meta whitespace-nowrap">
            <span className="t-numeral">{formatMicroAmount(v!)}</span>
            {" · "}
            <span className="t-numeral">{Math.round(pct!)}%</span> DV
          </span>
        ) : (
          <span
            className="t-meta italic"
            style={{ color: "var(--text-secondary)" }}
            title="No food logged today reported this micronutrient"
          >
            Not tracked
          </span>
        )}
      </div>
      <div
        className="h-2 overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--bg-secondary)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={tracked ? Math.round(Math.min(pct!, 100)) : 0}
        aria-label={`${dv.label} percent of daily value${tracked ? "" : " — not tracked"}`}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${barPct}%`,
            backgroundColor: tracked ? "var(--accent)" : "transparent",
          }}
        />
      </div>
    </div>
  );
}

export function MicronutrientSection({
  totals,
  className = "",
}: {
  /** Day totals from sumEntryMicros(); absent key = not tracked. */
  totals: MicroNutrients | null;
  className?: string;
}) {
  const t = totals ?? {};
  const nTracked = trackedMicroKeys(t).length;

  return (
    <GlassPanel className={`p-6 ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="t-card-heading flex items-center gap-1.5">
          Micronutrients
          <Tooltip tip="Reference Daily Values (U.S. FDA, 21 CFR 101.36) — a general population reference, not personalized advice. Values are estimates from USDA FoodData Central where the food reported them.">
            <Info size={13} aria-hidden="true" className="cursor-help" style={{ color: "var(--text-secondary)" }} />
          </Tooltip>
        </h2>
        <span className="t-meta" style={{ color: "var(--text-secondary)" }}>
          {nTracked} of {MICRO_KEYS.length} tracked today
        </span>
      </div>
      <p className="t-meta mb-3" style={{ color: "var(--text-secondary)" }}>
        Estimates from USDA reference values where reported — micros without data show{" "}
        <em>not tracked</em>, never 0.
      </p>
      <div>
        {MICRO_KEYS.map((k, i) => (
          <div
            key={k}
            className={i === 0 ? "" : "border-t"}
            style={{ borderColor: "var(--border)" }}
          >
            <MicroRow microKey={k} totals={t} />
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
