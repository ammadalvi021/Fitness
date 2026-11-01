"use client";

/**
 * /workouts/aerobics — Aerobics section browse (V22 Phase C).
 *
 * Loads the catalog from GET /api/aerobics/routines. Shows the six
 * category cards (each linking to that category's routine) and the full
 * routine list with level, duration and step count.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, HeartPulse, Layers } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  ErrorStateLux,
  GlassPanel,
  LuxBadge,
} from "@/components/luxury";
import { pickArray } from "../_shared";
import { luxDifficultyTone } from "../_lux";
import {
  AEROBICS_CATEGORIES,
  AerobicRoutineSummary,
  aerobicsCategoryName,
  formatDuration,
} from "./_shared";

const secondaryText = { color: "var(--text-secondary)" } as const;

export default function AerobicsBrowsePage() {
  const [routines, setRoutines] = useState<AerobicRoutineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<unknown>("/api/aerobics/routines");
      setRoutines(pickArray<AerobicRoutineSummary>(res, "routines"));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't load the aerobics catalog. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = new Map(routines.map((r) => [r.category, r]));

  return (
    <div className="anim-page-enter">
      <div className="mb-6">
        <h1 className="t-page-title flex items-center gap-3">
          <HeartPulse size={30} aria-hidden="true" style={{ color: "var(--accent)" }} />
          Aerobics
        </h1>
        <p className="mt-1 text-sm" style={secondaryText}>
          Guided follow-along routines with warm-up, main and cool-down phases.
          Pick a category or a full routine below.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3" aria-label="Loading aerobics routines">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      ) : error ? (
        <ErrorStateLux
          title="Couldn't load aerobics routines"
          message={error}
          onRetry={() => void load()}
          retryLabel="Try again"
        />
      ) : routines.length === 0 ? (
        <EmptyStateLux
          icon={<HeartPulse size={22} aria-hidden="true" />}
          title="No aerobics routines yet"
          message="The aerobics catalog is empty right now. Please check back soon."
        />
      ) : (
        <>
          {/* Category cards */}
          <section aria-label="Aerobics categories">
            <h2 className="t-card-heading mb-3">Categories</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {AEROBICS_CATEGORIES.map((cat) => {
                const routine = byCategory.get(cat.slug);
                const card = (
                  <GlassPanel className="anim-hover-lift flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="t-card-heading">{cat.name}</h3>
                      <ChevronRight
                        size={18}
                        aria-hidden="true"
                        className="mt-1 shrink-0"
                        style={{ color: "var(--accent)" }}
                      />
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed" style={secondaryText}>
                      {cat.blurb}
                    </p>
                    {routine ? (
                      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={secondaryText}>
                        <span className="inline-flex items-center gap-1">
                          <Clock size={13} aria-hidden="true" />
                          {formatDuration(routine.totalDurationSeconds)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Layers size={13} aria-hidden="true" />
                          {routine.stepCount} steps
                        </span>
                      </p>
                    ) : (
                      <p className="mt-3 text-xs" style={secondaryText}>
                        Coming soon
                      </p>
                    )}
                  </GlassPanel>
                );
                return routine ? (
                  <Link key={cat.slug} href={`/workouts/aerobics/${routine.slug}`} className="block h-full">
                    {card}
                  </Link>
                ) : (
                  <div key={cat.slug} aria-disabled="true" className="opacity-60">
                    {card}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Full routine list */}
          <section aria-label="All aerobics routines" className="mt-8">
            <h2 className="t-card-heading mb-3">All routines</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {routines.map((routine) => (
                <Link key={routine.slug} href={`/workouts/aerobics/${routine.slug}`} className="block">
                  <GlassPanel className="anim-hover-lift flex h-full flex-col p-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LuxBadge tone={luxDifficultyTone(routine.level)}>{routine.level}</LuxBadge>
                      <LuxBadge>{aerobicsCategoryName(routine.category)}</LuxBadge>
                    </div>
                    <h3 className="t-card-heading mt-2.5">{routine.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed" style={secondaryText}>
                      {routine.description}
                    </p>
                    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={secondaryText}>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} aria-hidden="true" />
                        {formatDuration(routine.totalDurationSeconds)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers size={13} aria-hidden="true" />
                        {routine.stepCount} steps
                      </span>
                    </p>
                  </GlassPanel>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
