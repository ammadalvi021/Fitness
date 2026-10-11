"use client";

/**
 * /workouts/library/[slug] — exercise technique guide.
 *
 * MEDIA AREA FIRST: the library shows a generated looping stick-figure
 * animation per exercise (see @/lib/exercise-animation) — never an
 * <img>/<video> with a broken or fake URL. Real media only renders when
 * mediaType + mediaUrl are both present and non-empty; the honest
 * placeholder remains as the final fallback.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import {
  Exercise,
  WORKOUT_SAFETY_COPY,
  asStringArray,
  difficultyTone,
  pickObject,
} from "../../_shared";
import {
  ExerciseAnimation,
  hasExerciseAnimation,
} from "@/components/ExerciseAnimation";

function MediaPanel({ exercise }: { exercise: Exercise }) {
  const hasMedia =
    exercise.mediaType &&
    exercise.mediaType !== "none" &&
    exercise.mediaUrl &&
    exercise.mediaUrl.trim().length > 0;

  if (hasMedia && exercise.mediaType === "video") {
    return (
      <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
        <video
          src={exercise.mediaUrl as string}
          controls
          preload="metadata"
          className="aspect-video w-full bg-black"
          aria-label={`${exercise.name} demonstration video`}
        />
      </div>
    );
  }
  if (hasMedia && exercise.mediaType === "image") {
    return (
      <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={exercise.mediaUrl as string}
          alt={`${exercise.name} demonstration`}
          className="aspect-video w-full object-cover"
        />
      </div>
    );
  }

  // Generated looping stick-figure demo (no database media needed).
  if (hasExerciseAnimation(exercise.slug)) {
    return (
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/40">
        <ExerciseAnimation
          slug={exercise.slug}
          label={`${exercise.name} animated demonstration`}
          className="mx-auto aspect-video w-full max-w-md"
        />
      </div>
    );
  }

  // Honest placeholder: no demo media exists for this exercise.
  return (
    <div
      role="img"
      aria-label={`No demonstration media for ${exercise.name}`}
      className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 text-center dark:border-neutral-700 dark:bg-neutral-800/40"
    >
      <span aria-hidden="true" className="text-3xl">
        📋
      </span>
      <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        Demo media not available
      </p>
      <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
        Follow the step-by-step instructions below.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

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

  const steps = exercise ? asStringArray(exercise.steps) : [];
  const mistakes = exercise ? asStringArray(exercise.commonMistakes) : [];

  return (
    <div>
      <PageHeader
        title={exercise ? exercise.name : "Exercise"}
        subtitle={exercise?.exerciseType ? `Type: ${exercise.exerciseType}` : undefined}
        actions={
          <Link href="/workouts/library">
            <Button variant="secondary">Back to library</Button>
          </Link>
        }
      />

      {loading ? (
        <div className="space-y-4" aria-label="Loading exercise">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : error || !exercise ? (
        <EmptyState
          title="Exercise not found"
          message={error ?? "This exercise doesn't exist."}
          action={
            <Link href="/workouts/library">
              <Button variant="secondary">Browse the library</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          <MediaPanel exercise={exercise} />

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={difficultyTone(exercise.difficulty)}>{exercise.difficulty}</Badge>
            {asStringArray(exercise.trainingStyles).map((s) => (
              <Badge key={s} tone="blue">
                {s}
              </Badge>
            ))}
            {exercise.homeSuitable ? <Badge>Home friendly</Badge> : null}
            {exercise.gymSuitable ? <Badge>Gym</Badge> : null}
          </div>

          {exercise.description ? (
            <Section title="Purpose">
              <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                {exercise.description}
              </p>
            </Section>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <Section title="Target muscles">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  {asStringArray(exercise.muscleGroups).join(", ") || "—"}
                </p>
              </Section>
            </Card>
            <Card>
              <Section title="Equipment">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  {asStringArray(exercise.equipment).join(", ") || "No equipment needed"}
                </p>
              </Section>
            </Card>
          </div>

          {steps.length ? (
            <Card>
              <Section title="How to do it">
                <ol className="space-y-2.5">
                  {steps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm text-neutral-700 dark:text-neutral-300">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand"
                      >
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            </Card>
          ) : null}

          {exercise.breathing ? (
            <Card>
              <Section title="Breathing">
                <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {exercise.breathing}
                </p>
              </Section>
            </Card>
          ) : null}

          {mistakes.length ? (
            <Card>
              <Section title="Common mistakes">
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
                  {mistakes.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </Section>
            </Card>
          ) : null}

          {exercise.easierVariation || exercise.harderVariation ? (
            <Card>
              <Section title="Make it easier or harder">
                <div className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
                  {exercise.easierVariation ? (
                    <p>
                      <strong className="text-neutral-900 dark:text-neutral-100">Easier: </strong>
                      {exercise.easierVariation}
                    </p>
                  ) : null}
                  {exercise.harderVariation ? (
                    <p>
                      <strong className="text-neutral-900 dark:text-neutral-100">Harder: </strong>
                      {exercise.harderVariation}
                    </p>
                  ) : null}
                </div>
              </Section>
            </Card>
          ) : null}

          {exercise.safetyNotes ? (
            <Card className="border-amber-300 dark:border-amber-800">
              <Section title="Safety notes">
                <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                  {exercise.safetyNotes}
                </p>
              </Section>
            </Card>
          ) : null}

          <p className="text-xs text-neutral-500 dark:text-neutral-400">{WORKOUT_SAFETY_COPY}</p>
        </div>
      )}
    </div>
  );
}
