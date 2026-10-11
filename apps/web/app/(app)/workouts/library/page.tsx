"use client";

/**
 * /workouts/library — searchable, filterable exercise library
 * (Obsidian Gold luxury presentation).
 *
 * Server-side search params (per CONTRACT: q, muscle, equipment, difficulty)
 * plus client-side filters for training style and home/gym, derived from the
 * fetched exercises so the UI stays correct as the library grows.
 *
 * PRESENTATION ONLY: search/filter logic is identical to the original.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Dumbbell, SearchX, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Input, Select, Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  ErrorStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
} from "@/components/luxury";
import {
  Exercise,
  asStringArray,
  pickArray,
} from "../_shared";
import { luxDifficultyTone } from "../_lux";
import {
  ExerciseAnimation,
  hasExerciseAnimation,
} from "@/components/ExerciseAnimation";

const ALL = "all";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort();
}

const secondaryText = { color: "var(--text-secondary)" } as const;

function LuxFilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="t-meta mb-1.5 block">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function ExerciseLibraryPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState(ALL);
  const [equipment, setEquipment] = useState(ALL);
  const [difficulty, setDifficulty] = useState(ALL);
  const [style, setStyle] = useState(ALL);
  const [location, setLocation] = useState(ALL); // all | home | gym

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await api<unknown>("/api/exercises");
        if (!cancelled) setExercises(pickArray<Exercise>(res, "exercises"));
      } catch (e) {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Couldn't load the exercise library.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const muscles = useMemo(
    () => uniqueSorted(exercises.flatMap((e) => asStringArray(e.muscleGroups))),
    [exercises]
  );
  const equipments = useMemo(
    () => uniqueSorted(exercises.flatMap((e) => asStringArray(e.equipment))),
    [exercises]
  );
  const styles = useMemo(
    () => uniqueSorted(exercises.flatMap((e) => asStringArray(e.trainingStyles))),
    [exercises]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises.filter((e) => {
      if (needle) {
        const hay = `${e.name} ${asStringArray(e.muscleGroups).join(" ")} ${asStringArray(e.equipment).join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (muscle !== ALL && !asStringArray(e.muscleGroups).includes(muscle)) return false;
      if (equipment !== ALL && !asStringArray(e.equipment).includes(equipment)) return false;
      if (difficulty !== ALL && e.difficulty !== difficulty) return false;
      if (style !== ALL && !asStringArray(e.trainingStyles).includes(style)) return false;
      if (location === "home" && !e.homeSuitable) return false;
      if (location === "gym" && !e.gymSuitable) return false;
      return true;
    });
  }, [exercises, q, muscle, equipment, difficulty, style, location]);

  const hasFilters =
    q.trim() !== "" || muscle !== ALL || equipment !== ALL || difficulty !== ALL || style !== ALL || location !== ALL;

  function clearFilters() {
    setQ("");
    setMuscle(ALL);
    setEquipment(ALL);
    setDifficulty(ALL);
    setStyle(ALL);
    setLocation(ALL);
  }

  return (
    <div className="anim-page-enter">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Exercise library</h1>
          <p className="mt-1 text-sm" style={secondaryText}>
            Technique-first guides for every movement. Pick one to see step-by-step instructions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/workouts">
            <LuxButton variant="secondary">
              <ArrowLeft size={17} aria-hidden="true" />
              Back to workouts
            </LuxButton>
          </Link>
        </div>
      </div>

      <GlassPanel className="mb-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LuxFilterField label="Search" htmlFor="ex-q">
            <Input
              id="ex-q"
              type="search"
              placeholder="e.g. squat, chest, dumbbell…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search exercises"
            />
          </LuxFilterField>
          <LuxFilterField label="Muscle group" htmlFor="ex-muscle">
            <Select id="ex-muscle" value={muscle} onChange={(e) => setMuscle(e.target.value)}>
              <option value={ALL}>All muscle groups</option>
              {muscles.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </LuxFilterField>
          <LuxFilterField label="Equipment" htmlFor="ex-equipment">
            <Select id="ex-equipment" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              <option value={ALL}>Any equipment</option>
              {equipments.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </LuxFilterField>
          <LuxFilterField label="Difficulty" htmlFor="ex-difficulty">
            <Select id="ex-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value={ALL}>Any difficulty</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Select>
          </LuxFilterField>
          <LuxFilterField label="Training style" htmlFor="ex-style">
            <Select id="ex-style" value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value={ALL}>Any style</option>
              {styles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </LuxFilterField>
          <LuxFilterField label="Location" htmlFor="ex-location">
            <Select id="ex-location" value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value={ALL}>Home &amp; gym</option>
              <option value="home">Home friendly</option>
              <option value="gym">Gym</option>
            </Select>
          </LuxFilterField>
        </div>
        {hasFilters ? (
          <div className="mt-4">
            <LuxButton variant="ghost" onClick={clearFilters}>
              <X size={16} aria-hidden="true" />
              Clear all filters
            </LuxButton>
          </div>
        ) : null}
      </GlassPanel>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading exercises">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : error ? (
        <ErrorStateLux
          title="Couldn't load exercises"
          message={error}
          onRetry={() => window.location.reload()}
          retryLabel="Retry"
        />
      ) : filtered.length === 0 ? (
        <EmptyStateLux
          icon={
            hasFilters ? (
              <SearchX size={22} aria-hidden="true" />
            ) : (
              <Dumbbell size={22} aria-hidden="true" />
            )
          }
          title={hasFilters ? "No exercises match those filters" : "No exercises yet"}
          message={
            hasFilters
              ? "Try widening your search or clearing a filter or two."
              : "The exercise library is empty right now — check back soon."
          }
          action={
            hasFilters ? (
              <LuxButton variant="secondary" onClick={clearFilters}>
                <X size={16} aria-hidden="true" />
                Clear filters
              </LuxButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm" style={secondaryText} role="status">
            {filtered.length} {filtered.length === 1 ? "exercise" : "exercises"}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <li key={e.slug}>
                <Link
                  href={`/workouts/library/${e.slug}`}
                  className="block h-full rounded-2xl"
                  aria-label={`View ${e.name} technique guide`}
                >
                  <GlassPanel className="anim-hover-lift flex h-full flex-col gap-2.5 p-4">
                    {hasExerciseAnimation(e.slug) ? (
                      <div
                        className="flex justify-center rounded-xl py-1"
                        style={{ backgroundColor: "var(--bg-secondary)" }}
                      >
                        <ExerciseAnimation
                          slug={e.slug}
                          label={`${e.name} animation`}
                          animated={false}
                          className="h-20 w-20"
                        />
                      </div>
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="t-card-heading">{e.name}</h3>
                      <LuxBadge tone={luxDifficultyTone(e.difficulty)}>{e.difficulty}</LuxBadge>
                    </div>
                    <p className="text-sm" style={secondaryText}>
                      <span className="t-meta mr-1.5">Muscles</span>
                      {asStringArray(e.muscleGroups).join(", ") || "—"}
                    </p>
                    <p className="text-sm" style={secondaryText}>
                      <span className="t-meta mr-1.5">Equipment</span>
                      {asStringArray(e.equipment).join(", ") || "—"}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                      {e.homeSuitable ? <LuxBadge>Home</LuxBadge> : null}
                      {e.gymSuitable ? <LuxBadge>Gym</LuxBadge> : null}
                      {asStringArray(e.trainingStyles)
                        .slice(0, 3)
                        .map((s) => (
                          <LuxBadge key={s} tone="accent">
                            {s}
                          </LuxBadge>
                        ))}
                    </div>
                  </GlassPanel>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
