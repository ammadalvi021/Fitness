"use client";

/**
 * /workouts/aerobics/[slug] — aerobics routine preview (V22 Phase C).
 *
 * Loads GET /api/aerobics/routines/[slug]: title, description, level,
 * intensity, total duration, and the steps grouped into warm-up, main
 * and cool-down phases with per-step durations and low-impact
 * alternatives. Media is honest: while a routine's mediaStatus is
 * "placeholder" a clearly labelled panel is shown instead of any fake
 * player.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock, Flame, Layers, Play, VideoOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import {
  ErrorStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  MediaPanelLux,
} from "@/components/luxury";
import { WORKOUT_SAFETY_COPY, pickObject } from "../../_shared";
import { luxDifficultyTone } from "../../_lux";
import { getGuidedMedia } from "@/lib/guided-media/manifest";
import {
  AerobicRoutineDetail,
  aerobicsCategoryName,
  formatDuration,
  formatHold,
  intensityLabel,
  phaseLabel,
} from "../_shared";

const secondaryText = { color: "var(--text-secondary)" } as const;

const PHASES = ["warmup", "main", "cooldown"] as const;

export default function AerobicsRoutinePage({ params }: { params: { slug: string } }) {
  const [routine, setRoutine] = useState<AerobicRoutineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await api<unknown>(`/api/aerobics/routines/${params.slug}`);
      const r = pickObject<AerobicRoutineDetail>(res, "routine");
      if (!r) throw new Error("The server returned an unexpected response.");
      setRoutine(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(
          e instanceof ApiError
            ? e.message
            : "Couldn't load this routine. Please try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [params.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const mediaIsPlaceholder =
    routine?.mediaStatus === "placeholder" ||
    !routine?.mediaStatus ||
    getGuidedMedia(params.slug)?.mediaStatus === "placeholder";

  return (
    <div className="anim-page-enter">
      <Link
        href="/workouts/aerobics"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        style={{ color: "var(--accent)" }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        All aerobics routines
      </Link>

      {loading ? (
        <div className="space-y-3" aria-label="Loading routine">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-40" />
        </div>
      ) : notFound ? (
        <ErrorStateLux
          title="Routine not found"
          message="This aerobics routine doesn't exist or may have been removed."
          onRetry={() => void load()}
          retryLabel="Try again"
        />
      ) : error ? (
        <ErrorStateLux
          title="Couldn't load this routine"
          message={error}
          onRetry={() => void load()}
          retryLabel="Try again"
        />
      ) : routine ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <LuxBadge tone={luxDifficultyTone(routine.level)}>{routine.level}</LuxBadge>
                <LuxBadge>{aerobicsCategoryName(routine.category)}</LuxBadge>
              </div>
              <h1 className="t-page-title mt-2">{routine.title}</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed" style={secondaryText}>
                {routine.description}
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={secondaryText}>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={15} aria-hidden="true" />
                  {formatDuration(routine.totalDurationSeconds)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={15} aria-hidden="true" />
                  {routine.stepCount} steps
                </span>
                {routine.intensity ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Flame size={15} aria-hidden="true" />
                    {intensityLabel(routine.intensity)} intensity
                  </span>
                ) : null}
              </p>
            </div>
            <Link href={`/workouts/aerobics/${routine.slug}/play`}>
              <LuxButton>
                <Play size={17} aria-hidden="true" />
                Start routine
              </LuxButton>
            </Link>
          </div>

          {/* Media area — honest placeholder until verified demos exist. */}
          <div className="mt-5">
            {mediaIsPlaceholder ? (
              <MediaPanelLux label="Demonstration media coming soon">
                <div className="flex flex-col items-center gap-2 px-6 text-center">
                  <VideoOff size={28} aria-hidden="true" style={{ color: "var(--accent)" }} />
                  <p className="text-sm font-medium">
                    Demonstration media coming soon — follow the written guidance
                  </p>
                  <p className="max-w-md text-xs leading-relaxed" style={secondaryText}>
                    Each step below includes its cue and, where available, a
                    low-impact alternative. The guided player will walk you
                    through every move.
                  </p>
                </div>
              </MediaPanelLux>
            ) : (
              <MediaPanelLux label="Demonstration">
                <p className="px-6 text-center text-sm" style={secondaryText}>
                  Follow along with the guided player below.
                </p>
              </MediaPanelLux>
            )}
          </div>

          {routine.safetyNotes ? (
            <div
              className="mt-4 flex gap-3 rounded-xl p-3"
              style={{
                backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)",
              }}
            >
              <AlertTriangle
                size={18}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                style={{ color: "var(--warning)" }}
              />
              <p className="text-sm leading-relaxed">
                <strong>Safety notes:</strong> {routine.safetyNotes}
              </p>
            </div>
          ) : null}

          {/* Phase breakdown */}
          {PHASES.map((phase) => {
            const steps = routine.steps.filter((s) => s.phase === phase);
            if (!steps.length) return null;
            return (
              <section key={phase} aria-label={`${phaseLabel(phase)} steps`} className="mt-6">
                <h2 className="t-card-heading mb-3">{phaseLabel(phase)}</h2>
                <GlassPanel className="px-5 py-2">
                  <ol>
                    {steps.map((step, i) => (
                      <li
                        key={`${step.id ?? step.name}-${step.order}`}
                        className="flex items-center justify-between gap-3 py-3"
                        style={{
                          borderBottom:
                            i < steps.length - 1
                              ? "1px solid var(--border)"
                              : undefined,
                        }}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className="t-numeral mt-0.5 w-6 shrink-0 text-sm"
                            style={{ color: "var(--accent)" }}
                            aria-hidden="true"
                          >
                            {step.order}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{step.name}</p>
                            {step.cue ? (
                              <p className="mt-0.5 text-xs" style={secondaryText}>
                                {step.cue}
                              </p>
                            ) : null}
                            {step.lowImpactAlternative ? (
                              <p className="mt-0.5 text-xs" style={secondaryText}>
                                Low-impact: {step.lowImpactAlternative}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="t-numeral text-sm">{formatHold(step.durationSeconds)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </GlassPanel>
              </section>
            );
          })}

          <div className="mt-6">
            <Link href={`/workouts/aerobics/${routine.slug}/play`}>
              <LuxButton>
                <Play size={17} aria-hidden="true" />
                Start routine
              </LuxButton>
            </Link>
          </div>

          <p className="mt-8 text-xs leading-relaxed" style={secondaryText}>
            {WORKOUT_SAFETY_COPY}
          </p>
        </>
      ) : null}
    </div>
  );
}
