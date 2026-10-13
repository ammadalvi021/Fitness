"use client";

/**
 * ExpenditureCard — "Your real burn": adaptive TDEE back-solved from the
 * user's last 21 days of food logs + weigh-ins, vs the static Mifflin-St
 * Jeor estimate. One-tap (with inline confirmation) "Use as my calorie
 * target" writes the existing PUT /api/profile override — targets are never
 * changed silently.
 */
import { useCallback, useEffect, useState } from "react";
import { Flame, Info, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import {
  EmptyStateLux,
  ErrorStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  Tooltip as LuxTooltip,
} from "@/components/luxury";

type Confidence = "low" | "medium" | "high";

export interface ExpenditureResponse {
  status: "ok" | "insufficient_data";
  tdeeKcal?: number;
  avgIntakeKcal?: number;
  weightSlopeKgPerDay?: number;
  confidence?: Confidence;
  daysUsed?: number;
  daysAvailable?: number;
  daysNeeded?: number;
  windowDays?: number;
  currentTargetKcal?: number;
  overrideActive?: boolean;
}

interface ExpenditureCardProps {
  /** Static Mifflin-St Jeor TDEE from the profile targets (for comparison). */
  staticTdeeKcal: number | null;
  /** Called after the override is set/cleared so the page can recompute targets. */
  onApplyTarget: (kcal: number | null) => void;
  /** Test/preview escape hatch: render this data without fetching. */
  initialData?: ExpenditureResponse;
}

const CONFIDENCE_TONE: Record<Confidence, "neutral" | "accent" | "success"> = {
  low: "neutral",
  medium: "accent",
  high: "success",
};

export function ExpenditureCard({
  staticTdeeKcal,
  onApplyTarget,
  initialData,
}: ExpenditureCardProps) {
  const [data, setData] = useState<ExpenditureResponse | null>(initialData ?? null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">(
    initialData ? "ok" : "loading"
  );
  const [confirming, setConfirming] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (initialData) return;
    setStatus("loading");
    setConfirming(false);
    setApplyError(null);
    try {
      const res = await api<ExpenditureResponse>("/api/insights/expenditure");
      setData(res);
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, [initialData]);

  useEffect(() => {
    if (!initialData) void load();
  }, [load, initialData]);

  async function apply(kcal: number | null) {
    setApplyBusy(true);
    setApplyError(null);
    try {
      await api("/api/profile", {
        method: "PUT",
        body: { calorieTargetOverrideKcal: kcal },
      });
      setConfirming(false);
      onApplyTarget(kcal);
      // Re-fetch so overrideActive / currentTargetKcal reflect the change.
      await load();
    } catch {
      setApplyError(
        kcal === null
          ? "Couldn't reset your target — please try again."
          : "Couldn't set your target — please try again."
      );
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <GlassPanel className="p-6">
      <h2 className="t-meta flex items-center gap-1.5">
        <Flame size={14} aria-hidden="true" style={{ color: "var(--accent)" }} />
        Your real burn
        <LuxTooltip tip="Estimated from YOUR last 21 days: average logged intake minus (weight change × 7,700 kcal/kg), smoothed over the week. Needs at least 7 days with both food logs and weigh-ins. This is an estimate, not medical advice.">
          <Info
            size={13}
            aria-hidden="true"
            className="cursor-help"
            style={{ color: "var(--text-secondary)" }}
          />
        </LuxTooltip>
      </h2>

      {status === "loading" && (
        <div className="mt-4 animate-pulse space-y-3" aria-hidden="true">
          <div className="h-9 w-32 rounded" style={{ background: "var(--bg-secondary)" }} />
          <div className="h-4 w-56 rounded" style={{ background: "var(--bg-secondary)" }} />
        </div>
      )}

      {status === "error" && (
        <ErrorStateLux
          className="mt-3 border-0 bg-transparent p-4 shadow-none"
          title="Couldn't load your real burn"
          message="Your adaptive TDEE is unavailable right now — retry, or come back later."
          onRetry={() => void load()}
          retryLabel="Retry"
        />
      )}

      {status === "ok" && data?.status === "insufficient_data" && (
        <EmptyStateLux
          className="mt-3 border-0 bg-transparent p-4 shadow-none"
          icon={<Flame size={22} aria-hidden="true" />}
          title="Not enough data yet"
          message={
            `Your real burn needs at least ${data.daysNeeded ?? 7} days with ` +
            `both food logs and weigh-ins (you have ${data.daysAvailable ?? 0} in ` +
            `the last ${data.windowDays ?? 21} days). Keep logging food and ` +
            `weigh in regularly to unlock it.`
          }
          action={<LuxButton variant="secondary" onClick={() => void load()}>Recheck</LuxButton>}
        />
      )}

      {status === "ok" && data?.status === "ok" && (
        <div className="mt-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="t-numeral text-4xl leading-none" aria-live="polite">
                {Math.round(data.tdeeKcal ?? 0).toLocaleString()}
                <span className="t-meta ml-1.5">kcal/day</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <LuxBadge tone={CONFIDENCE_TONE[data.confidence ?? "low"]}>
                  {data.confidence === "high"
                    ? "High confidence"
                    : data.confidence === "medium"
                      ? "Medium confidence"
                      : "Low confidence"}
                </LuxBadge>
                <span className="t-meta">
                  Based on <span className="t-numeral">{data.daysUsed}</span> days of logs
                  + weigh-ins
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="t-meta">Static estimate (Mifflin-St Jeor)</p>
              <p className="t-numeral text-xl" aria-live="polite">
                {staticTdeeKcal != null
                  ? `${staticTdeeKcal.toLocaleString()} kcal/day`
                  : "—"}
              </p>
            </div>
          </div>

          <p className="t-body mt-3" style={{ color: "var(--text-secondary)" }}>
            Avg logged intake{" "}
            <span className="t-numeral">{(data.avgIntakeKcal ?? 0).toLocaleString()}</span> kcal/day
            {typeof data.weightSlopeKgPerDay === "number" && (
              <>
                {" "}· weight trend{" "}
                <span className="t-numeral">
                  {data.weightSlopeKgPerDay > 0 ? "+" : ""}
                  {(data.weightSlopeKgPerDay * 1000).toFixed(0)} g/day
                </span>
              </>
            )}
            .
          </p>

          {data.overrideActive && (
            <p className="t-meta mt-2">
              Your daily target is currently set to this estimated burn. You can
              switch back any time.
            </p>
          )}

          {applyError && (
            <p className="t-body mt-3" role="alert" style={{ color: "var(--error, #d44)" }}>
              {applyError}
            </p>
          )}

          {confirming ? (
            <div
              className="mt-4 rounded-2xl border p-4"
              style={{ borderColor: "var(--accent)", background: "var(--bg-secondary)" }}
              role="alertdialog"
              aria-labelledby="expenditure-confirm-title"
            >
              <p id="expenditure-confirm-title" className="t-body font-medium">
                Set {Math.round(data.tdeeKcal ?? 0).toLocaleString()} kcal/day as your
                daily calorie target?
              </p>
              <p className="t-meta mt-1">
                This replaces your calculated target everywhere it is shown. You
                can reset it at any time.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <LuxButton disabled={applyBusy} onClick={() => void apply(Math.round(data.tdeeKcal ?? 0))}>
                  {applyBusy ? "Setting…" : "Yes, use it"}
                </LuxButton>
                <LuxButton variant="secondary" disabled={applyBusy} onClick={() => setConfirming(false)}>
                  Cancel
                </LuxButton>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <LuxButton onClick={() => setConfirming(true)}>
                Use as my calorie target
              </LuxButton>
              {data.overrideActive && (
                <LuxButton
                  variant="secondary"
                  disabled={applyBusy}
                  onClick={() => void apply(null)}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  {applyBusy ? "Resetting…" : "Reset to calculated target"}
                </LuxButton>
              )}
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
