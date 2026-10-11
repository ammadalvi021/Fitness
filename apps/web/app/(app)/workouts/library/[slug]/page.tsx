"use client";

/**
 * /workouts/library/[slug] — exercise technique guide
 * (Obsidian Gold luxury presentation).
 *
 * MEDIA AREA FIRST: <ExerciseMedia> renders real human video only when the
 * EXERCISE_MEDIA registry (or mediaType/mediaUrl) provides a real,
 * professionally-reviewed URL — never an invented or broken URL. The
 * interim labeled "Animated demonstration" is kept (commissioned UX), and
 * the honest "Video coming soon" panel is the final fallback. Written
 * technique instructions are always rendered below the media.
 *
 * PRESENTATION ONLY: the media/technique rendering and data fetching are
 * untouched — only the surrounding page chrome was restyled.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Dumbbell } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
} from "@/components/luxury";
import {
  Exercise,
  WORKOUT_SAFETY_COPY,
  asStringArray,
  pickObject,
} from "../../_shared";
import { luxDifficultyTone } from "../../_lux";
import { ExerciseMedia } from "@/components/ExerciseMedia";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="t-card-heading mb-2">{title}</h2>
      {children}
    </section>
  );
}

const secondaryText = { color: "var(--text-secondary)" } as const;

export default function ExerciseDetailPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await api<unknown>(`/api/exercises/${encodeURIComponent(slug)}`);
        const ex = pickObject<Exercise>(res, "exercise");
        if (!cancelled) {
          if (ex) setExercise(ex);
          else setError("We couldn't find that exercise.");
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof ApiError && e.status === 404
              ? "We couldn't find that exercise."
              : e instanceof ApiError
                ? e.message
                : "Couldn't load this exercise."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="anim-page-enter mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">{exercise ? exercise.name : "Exercise"}</h1>
          {exercise?.exerciseType ? (
            <p className="mt-1 text-sm" style={secondaryText}>
              Type: {exercise.exerciseType}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/workouts/library">
            <LuxButton variant="secondary">
              <ArrowLeft size={17} aria-hidden="true" />
              Back to library
            </LuxButton>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4" aria-label="Loading exercise">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : error || !exercise ? (
        <EmptyStateLux
          icon={<Dumbbell size={22} aria-hidden="true" />}
          title="Exercise not found"
          message={error ?? "This exercise doesn't exist."}
          action={
            <Link href="/workouts/library">
              <LuxButton variant="secondary">
                <ArrowLeft size={17} aria-hidden="true" />
                Browse the library
              </LuxButton>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Media priority + always-present technique panel — DO NOT RESTYLE the internals. */}
          <ExerciseMedia
            slug={exercise.slug}
            name={exercise.name}
            mediaType={exercise.mediaType}
            mediaUrl={exercise.mediaUrl}
            technique={exercise}
          />

          <div className="flex flex-wrap items-center gap-2">
            <LuxBadge tone={luxDifficultyTone(exercise.difficulty)}>
              {exercise.difficulty}
            </LuxBadge>
            {asStringArray(exercise.trainingStyles).map((s) => (
              <LuxBadge key={s} tone="accent">
                {s}
              </LuxBadge>
            ))}
            {exercise.homeSuitable ? <LuxBadge>Home friendly</LuxBadge> : null}
            {exercise.gymSuitable ? <LuxBadge>Gym</LuxBadge> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <GlassPanel className="p-5">
              <Section title="Target muscles">
                <p className="text-sm leading-relaxed">
                  {asStringArray(exercise.muscleGroups).join(", ") || "—"}
                </p>
              </Section>
            </GlassPanel>
            <GlassPanel className="p-5">
              <Section title="Equipment">
                <p className="text-sm leading-relaxed">
                  {asStringArray(exercise.equipment).join(", ") || "No equipment needed"}
                </p>
              </Section>
            </GlassPanel>
          </div>

          <p className="text-xs leading-relaxed" style={secondaryText}>
            {WORKOUT_SAFETY_COPY}
          </p>
        </div>
      )}
    </div>
  );
}
