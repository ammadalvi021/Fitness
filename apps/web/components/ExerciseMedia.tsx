/**
 * ExerciseMedia — honest human-demonstration media + technique panel.
 *
 * Media priority (see lib/exercise-media/select.ts):
 *   1. VERIFIED human asset (registry entry with verificationStatus
 *      "verified", or a database video) — gif / webp / mp4 / webm, with
 *      poster, loading and error states, accessible controls, playsInline,
 *      lazy loading, reserved dimensions. A broken URL falls through to the
 *      illustration — never a broken image.
 *   2. Three-stage static ILLUSTRATION — start / mid-rep / finish frames
 *      rendered from the pose engine, captioned
 *      "Illustration — human demonstration coming soon". Never presented
 *      as footage.
 *   3. Honest "Human demonstration coming soon" panel + text instructions.
 *
 * The looping animated SVG demos (<ExerciseAnimation>) are NOT rendered on
 * any customer-facing page anymore; the engine code remains in the repo
 * solely as the illustration source.
 *
 * ALWAYS rendered below the media: the technique instruction panel,
 * sourced ONLY from the exercise's existing fields (never invented, never
 * claimed as medically reviewed).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "./ui";
import { ExerciseIllustration, hasExerciseIllustration } from "./ExerciseIllustration";
import {
  getExerciseMedia,
  type ExerciseMediaType,
} from "@/lib/exercise-media/registry";
import { selectMediaSource } from "@/lib/exercise-media/select";
import { asStringArray } from "@/app/(app)/workouts/_shared";

/** Subset of the Exercise fields ExerciseMedia may render. Renders only fields that exist. */
export interface ExerciseTechnique {
  description?: string | null;
  steps?: unknown;
  breathing?: string | null;
  commonMistakes?: unknown;
  easierVariation?: string | null;
  harderVariation?: string | null;
  safetyNotes?: string | null;
}

export interface ExerciseMediaProps {
  slug: string;
  name: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  className?: string;
  /** Exercise record (or subset) — technique panel renders only fields that exist. */
  technique?: ExerciseTechnique | null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const BTN =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors";

const BTN_IDLE =
  "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";

const BTN_ACTIVE =
  "border border-brand bg-brand/10 text-brand dark:border-brand dark:text-brand";

const SUPPORTED_TYPES: ExerciseMediaType[] = ["gif", "webp", "mp4", "webm"];

interface ResolvedAsset {
  url: string;
  type: ExerciseMediaType;
  posterUrl: string | null;
  attribution: string | null;
}

/**
 * Resolve a VERIFIED human asset for a slug, or null. Registry entries count
 * only when verificationStatus === "verified" with a real URL; database
 * media counts for the supported types with a non-empty URL. Nothing is
 * invented here — null means "no human asset".
 */
export function resolveVerifiedAsset(
  slug: string,
  mediaType?: string | null,
  mediaUrl?: string | null
): ResolvedAsset | null {
  const entry = getExerciseMedia(slug);
  if (
    entry &&
    entry.verificationStatus === "verified" &&
    entry.mediaType &&
    SUPPORTED_TYPES.includes(entry.mediaType) &&
    entry.assetUrl &&
    entry.assetUrl.trim()
  ) {
    return {
      url: entry.assetUrl.trim(),
      type: entry.mediaType,
      posterUrl: entry.posterUrl?.trim() || null,
      attribution: entry.attribution?.trim() || null,
    };
  }
  const dbType = (mediaType ?? "").trim().toLowerCase();
  if (
    (SUPPORTED_TYPES as string[]).includes(dbType) &&
    mediaUrl &&
    mediaUrl.trim()
  ) {
    return {
      url: mediaUrl.trim(),
      type: dbType as ExerciseMediaType,
      posterUrl: null,
      attribution: null,
    };
  }
  // Legacy: mediaType === "video" implies mp4.
  if (dbType === "video" && mediaUrl && mediaUrl.trim()) {
    return { url: mediaUrl.trim(), type: "mp4", posterUrl: null, attribution: null };
  }
  return null;
}

/* ------------------------------- Real video ------------------------------- */

function RealVideoPlayer({
  videoUrl,
  posterUrl,
  name,
  reduceMotion,
}: {
  videoUrl: string;
  posterUrl: string | null;
  name: string;
  reduceMotion: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // The <source> attaches only when the player scrolls into view or the
  // user explicitly asks for the video — no wasted bandwidth otherwise.
  const [sourceAttached, setSourceAttached] = useState(false);
  const [slowMotion, setSlowMotion] = useState(false);
  const [seamlessLoop, setSeamlessLoop] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || sourceAttached) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSourceAttached(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sourceAttached]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = slowMotion ? 0.5 : 1;
  }, [slowMotion]);

  const replay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {
      /* user gesture required — native controls remain available */
    });
  };

  return (
    <div ref={wrapRef}>
      <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-black dark:border-neutral-800">
        <video
          ref={videoRef}
          className="aspect-video w-full"
          controls
          playsInline
          preload="metadata"
          poster={posterUrl ?? undefined}
          loop={seamlessLoop}
          muted={seamlessLoop}
          aria-label={`${name} demonstration video`}
        >
          {sourceAttached ? <source src={videoUrl} type="video/mp4" /> : null}
          Your browser does not support the video element.
        </video>
        {!sourceAttached ? (
          <button
            type="button"
            onClick={() => setSourceAttached(true)}
            aria-label={`Load the ${name} demonstration video`}
            className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"
          >
            <span className="flex min-h-[44px] items-center gap-2 rounded-full bg-white/90 px-5 py-2.5 text-sm font-semibold text-neutral-900">
              <span aria-hidden="true">▶</span> Load video
            </span>
          </button>
        ) : null}
      </div>

      {/* Custom controls — native controls cover play/pause; these add the extras. */}
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`${name} video playback options`}>
        <button
          type="button"
          onClick={replay}
          aria-label={`Replay the ${name} demonstration from the start`}
          className={`${BTN} ${BTN_IDLE}`}
        >
          <span aria-hidden="true">↺</span> Replay
        </button>
        <button
          type="button"
          onClick={() => setSlowMotion((s) => !s)}
          aria-pressed={slowMotion}
          aria-label={`${slowMotion ? "Turn off" : "Turn on"} 0.5x slow motion`}
          className={`${BTN} ${slowMotion ? BTN_ACTIVE : BTN_IDLE}`}
        >
          0.5× Slow-mo
        </button>
        <button
          type="button"
          onClick={() => setSeamlessLoop((l) => !l)}
          aria-pressed={seamlessLoop}
          aria-label={`${seamlessLoop ? "Turn off" : "Turn on"} muted seamless loop`}
          className={`${BTN} ${seamlessLoop ? BTN_ACTIVE : BTN_IDLE}`}
        >
          <span aria-hidden="true">∞</span> Loop
        </button>
      </div>

      {reduceMotion ? (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Reduced-motion is on: this video never autoplays. Use the player controls to watch it.
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------- Animated image (gif/webp) -------------------- */

function AnimatedImageAsset({
  url,
  posterUrl,
  name,
  reduceMotion,
  onError,
}: {
  url: string;
  posterUrl: string | null;
  name: string;
  reduceMotion: boolean;
  onError: () => void;
}) {
  // Reduced-motion: don't load the animation until the user explicitly
  // asks — show the poster (or a play affordance) instead.
  const [playRequested, setPlayRequested] = useState(!reduceMotion);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/40">
      <div className="relative aspect-video w-full">
        {!loaded && (
          <div
            className="absolute inset-0 animate-pulse bg-neutral-200 dark:bg-neutral-800"
            aria-hidden="true"
          />
        )}
        {playRequested ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`${name} human demonstration`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={onError}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={posterUrl}
            alt={`${name} demonstration poster`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={onError}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : null}
        {!playRequested ? (
          <button
            type="button"
            onClick={() => setPlayRequested(true)}
            aria-label={`Play the ${name} demonstration`}
            className="absolute inset-0 flex items-center justify-center bg-black/30"
          >
            <span className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/90 px-5 py-2.5 text-sm font-semibold text-neutral-900">
              <span aria-hidden="true">▶</span>
              <span className="ml-2">Play demonstration</span>
            </span>
          </button>
        ) : null}
      </div>
      <p className="border-t border-neutral-200 px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Human demonstration
      </p>
    </div>
  );
}

/* ------------------------------- Illustration ----------------------------- */

function IllustrationPanel({ slug, name }: { slug: string; name: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-800/40">
      <ExerciseIllustration slug={slug} name={name} />
    </div>
  );
}

/* ------------------------------- Coming soon ------------------------------ */

function ComingSoonPanel({ name }: { name: string }) {
  return (
    <div
      role="img"
      aria-label={`No human demonstration for ${name} yet`}
      className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 text-center dark:border-neutral-700 dark:bg-neutral-800/40"
    >
      <span aria-hidden="true" className="text-3xl">
        🎬
      </span>
      <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        Human demonstration coming soon
      </p>
      <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
        A professionally reviewed human demonstration is not available for
        this exercise yet. Follow the step-by-step instructions below.
      </p>
    </div>
  );
}

/* ---------------------------- Technique panel ----------------------------- */

function TechniqueSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TechniquePanel({ technique }: { technique: ExerciseTechnique | null | undefined }) {
  if (!technique) return null;

  const steps = asStringArray(technique.steps);
  const mistakes = asStringArray(technique.commonMistakes);

  return (
    <div className="space-y-4">
      {technique.description ? (
        <TechniqueSection title="Purpose">
          <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {technique.description}
          </p>
        </TechniqueSection>
      ) : null}

      {steps.length ? (
        <Card>
          <TechniqueSection title="How to do it">
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
          </TechniqueSection>
        </Card>
      ) : null}

      {technique.breathing ? (
        <Card>
          <TechniqueSection title="Breathing">
            <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
              {technique.breathing}
            </p>
          </TechniqueSection>
        </Card>
      ) : null}

      {mistakes.length ? (
        <Card>
          <TechniqueSection title="Common mistakes">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
              {mistakes.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </TechniqueSection>
        </Card>
      ) : null}

      {technique.easierVariation || technique.harderVariation ? (
        <Card>
          <TechniqueSection title="Make it easier or harder">
            <div className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
              {technique.easierVariation ? (
                <p>
                  <strong className="text-neutral-900 dark:text-neutral-100">Easier: </strong>
                  {technique.easierVariation}
                </p>
              ) : null}
              {technique.harderVariation ? (
                <p>
                  <strong className="text-neutral-900 dark:text-neutral-100">Harder: </strong>
                  {technique.harderVariation}
                </p>
              ) : null}
            </div>
          </TechniqueSection>
        </Card>
      ) : null}

      {technique.safetyNotes ? (
        <Card className="border-amber-300 dark:border-amber-800">
          <TechniqueSection title="Safety notes">
            <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
              {technique.safetyNotes}
            </p>
          </TechniqueSection>
        </Card>
      ) : null}
    </div>
  );
}

/* --------------------------------- Export --------------------------------- */

export function ExerciseMedia({
  slug,
  name,
  mediaType,
  mediaUrl,
  className,
  technique,
}: ExerciseMediaProps) {
  const reduceMotion = usePrefersReducedMotion();
  const source = selectMediaSource(slug, mediaType, mediaUrl);
  const asset = resolveVerifiedAsset(slug, mediaType, mediaUrl);
  // A broken asset URL falls through to the illustration — never a broken image.
  const [assetFailed, setAssetFailed] = useState(false);

  const showAsset = source === "video" && asset && !assetFailed;

  return (
    <div className={className}>
      {showAsset && (asset.type === "mp4" || asset.type === "webm") ? (
        <RealVideoPlayer
          videoUrl={asset.url}
          posterUrl={asset.posterUrl}
          name={name}
          reduceMotion={reduceMotion}
        />
      ) : showAsset && (asset.type === "gif" || asset.type === "webp") ? (
        <AnimatedImageAsset
          url={asset.url}
          posterUrl={asset.posterUrl}
          name={name}
          reduceMotion={reduceMotion}
          onError={() => setAssetFailed(true)}
        />
      ) : source === "illustration" || hasExerciseIllustration(slug) ? (
        <IllustrationPanel slug={slug} name={name} />
      ) : (
        <ComingSoonPanel name={name} />
      )}

      {/* Written instructions are ALWAYS present — media never replaces them. */}
      <div className="mt-6">
        <TechniquePanel technique={technique} />
      </div>
    </div>
  );
}
