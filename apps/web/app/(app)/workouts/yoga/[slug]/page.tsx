"use client";

/**
 * /workouts/yoga/[slug] — yoga session preview (V22 Phase B).
 *
 * Loads GET /api/yoga/sequences/[slug]: title, description, level, total
 * duration, the ordered pose list (name, Sanskrit name, hold time, side),
 * safety notes, and the media area. Media is honest: while a sequence's
 * mediaStatus is "placeholder" a clearly labelled panel is shown instead
 * of any fake player.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock, Layers, Play, VideoOff } from "lucide-react";
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
import {
  YogaSequenceDetail,
  formatDuration,
  formatHold,
  sideLabel,
  yogaCategoryName,
} from "../_shared";

const secondaryText = { color: "var(--text-secondary)" } as const;

export default function YogaSequencePage({ params }: { params: { slug: string } }) {
  const [sequence, setSequence] = useState<YogaSequenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await api<unknown>(`/api/yoga/sequences/${params.slug}`);
      const seq = pickObject<YogaSequenceDetail>(res, "sequence");
      if (!seq) throw new Error("The server returned an unexpected response.");
      setSequence(seq);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(
          e instanceof ApiError
            ? e.message
            : "Couldn't load this session. Please try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [params.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="anim-page-enter">
      <Link
        href="/workouts/yoga"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        style={{ color: "var(--accent)" }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        All yoga sessions
      </Link>

      {loading ? (
        <div className="space-y-3" aria-label="Loading session">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-40" />
        </div>
      ) : notFound ? (
        <ErrorStateLux
          title="Session not found"
          message="This yoga session doesn't exist or may have been removed."
          onRetry={() => void load()}
          retryLabel="Try again"
        />
      ) : error ? (
        <ErrorStateLux
          title="Couldn't load this session"
          message={error}
          onRetry={() => void load()}
          retryLabel="Try again"
        />
      ) : sequence ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <LuxBadge tone={luxDifficultyTone(sequence.level)}>{sequence.level}</LuxBadge>
                <LuxBadge>{yogaCategoryName(sequence.category)}</LuxBadge>
              </div>
              <h1 className="t-page-title mt-2">{sequence.title}</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed" style={secondaryText}>
                {sequence.description}
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={secondaryText}>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={15} aria-hidden="true" />
                  {formatDuration(sequence.totalDurationSeconds)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={15} aria-hidden="true" />
                  {sequence.poseCount} poses
                </span>
              </p>
            </div>
            <Link href={`/workouts/yoga/${sequence.slug}/play`}>
              <LuxButton>
                <Play size={17} aria-hidden="true" />
                Start session
              </LuxButton>
            </Link>
          </div>

          {/* Media area — honest placeholder until verified demos exist. */}
          <div className="mt-5">
            {sequence.mediaStatus === "placeholder" || !sequence.mediaStatus ? (
              <MediaPanelLux label="Demonstration media coming soon">
                <div className="flex flex-col items-center gap-2 px-6 text-center">
                  <VideoOff size={28} aria-hidden="true" style={{ color: "var(--accent)" }} />
                  <p className="text-sm font-medium">
                    Demonstration media coming soon — follow the written guidance
                  </p>
                  <p className="max-w-md text-xs leading-relaxed" style={secondaryText}>
                    Each pose below includes step-by-step instructions and breathing
                    cues. The guided player will walk you through every hold.
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

          {sequence.safetyNotes ? (
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
                <strong>Safety notes:</strong> {sequence.safetyNotes}
              </p>
            </div>
          ) : null}

          {/* Pose sequence */}
          <section aria-label="Pose sequence" className="mt-6">
            <h2 className="t-card-heading mb-3">Pose sequence</h2>
            <GlassPanel className="px-5 py-2">
              <ol>
                {sequence.poses.map((step, i) => (
                  <li
                    key={`${step.pose.slug}-${step.order}`}
                    className="flex items-center justify-between gap-3 py-3"
                    style={{
                      borderBottom:
                        i < sequence.poses.length - 1
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
                        <p className="truncate text-sm font-medium">{step.pose.name}</p>
                        {step.pose.sanskritName ? (
                          <p className="text-xs italic" style={secondaryText}>
                            {step.pose.sanskritName}
                          </p>
                        ) : null}
                        {step.cue ? (
                          <p className="mt-0.5 text-xs" style={secondaryText}>
                            {step.cue}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="t-numeral text-sm">{formatHold(step.holdSeconds)}</p>
                      <p className="text-xs" style={secondaryText}>
                        {sideLabel(step.side)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </GlassPanel>
          </section>

          <div className="mt-6">
            <Link href={`/workouts/yoga/${sequence.slug}/play`}>
              <LuxButton>
                <Play size={17} aria-hidden="true" />
                Start session
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
