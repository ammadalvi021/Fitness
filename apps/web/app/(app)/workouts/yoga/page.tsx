"use client";

/**
 * /workouts/yoga — Yoga section browse (V22 Phase B).
 *
 * Loads the catalog from GET /api/yoga/sequences (Phase A). Shows the seven
 * category cards (each linking to that category's sequence) and the full
 * sequence list with level, pose count and total duration.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, Flower2, Layers } from "lucide-react";
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
  YOGA_CATEGORIES,
  YogaSequenceSummary,
  formatDuration,
} from "./_shared";

const secondaryText = { color: "var(--text-secondary)" } as const;

export default function YogaBrowsePage() {
  const [sequences, setSequences] = useState<YogaSequenceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<unknown>("/api/yoga/sequences");
      setSequences(pickArray<YogaSequenceSummary>(res, "sequences"));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't load the yoga catalog. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = new Map(sequences.map((s) => [s.category, s]));

  return (
    <div className="anim-page-enter">
      <div className="mb-6">
        <h1 className="t-page-title flex items-center gap-3">
          <Flower2 size={30} aria-hidden="true" style={{ color: "var(--accent)" }} />
          Yoga
        </h1>
        <p className="mt-1 text-sm" style={secondaryText}>
          Guided pose-by-pose sessions with hold timers, breathing cues and
          beginner modifications. Pick a category or a full session below.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3" aria-label="Loading yoga sessions">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      ) : error ? (
        <ErrorStateLux
          title="Couldn't load yoga sessions"
          message={error}
          onRetry={() => void load()}
          retryLabel="Try again"
        />
      ) : sequences.length === 0 ? (
        <EmptyStateLux
          icon={<Flower2 size={22} aria-hidden="true" />}
          title="No yoga sessions yet"
          message="The yoga catalog is empty right now. Please check back soon."
        />
      ) : (
        <>
          {/* Category cards */}
          <section aria-label="Yoga categories">
            <h2 className="t-card-heading mb-3">Categories</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {YOGA_CATEGORIES.map((cat) => {
                const seq = byCategory.get(cat.slug);
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
                    {seq ? (
                      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={secondaryText}>
                        <span className="inline-flex items-center gap-1">
                          <Clock size={13} aria-hidden="true" />
                          {formatDuration(seq.totalDurationSeconds)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Layers size={13} aria-hidden="true" />
                          {seq.poseCount} poses
                        </span>
                      </p>
                    ) : (
                      <p className="mt-3 text-xs" style={secondaryText}>
                        Coming soon
                      </p>
                    )}
                  </GlassPanel>
                );
                return seq ? (
                  <Link key={cat.slug} href={`/workouts/yoga/${seq.slug}`} className="block h-full">
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

          {/* Full sequence list */}
          <section aria-label="All yoga sessions" className="mt-8">
            <h2 className="t-card-heading mb-3">All sessions</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {sequences.map((seq) => (
                <Link key={seq.slug} href={`/workouts/yoga/${seq.slug}`} className="block">
                  <GlassPanel className="anim-hover-lift flex h-full flex-col p-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LuxBadge tone={luxDifficultyTone(seq.level)}>{seq.level}</LuxBadge>
                      <LuxBadge>{YOGA_CATEGORIES.find((c) => c.slug === seq.category)?.name ?? seq.category}</LuxBadge>
                    </div>
                    <h3 className="t-card-heading mt-2.5">{seq.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed" style={secondaryText}>
                      {seq.description}
                    </p>
                    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={secondaryText}>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} aria-hidden="true" />
                        {formatDuration(seq.totalDurationSeconds)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers size={13} aria-hidden="true" />
                        {seq.poseCount} poses
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
