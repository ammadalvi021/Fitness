"use client";

/**
 * /workouts/library — searchable, filterable exercise library.
 *
 * Server-side search params (per CONTRACT: q, muscle, equipment, difficulty)
 * plus client-side filters for training style and home/gym, derived from the
 * fetched exercises so the UI stays correct as the library grows.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  Exercise,
  asStringArray,
  difficultyTone,
  pickArray,
} from "../_shared";

const ALL = "all";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort();
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
    <div>
      <PageHeader
        title="Exercise library"
        subtitle="Technique-first guides for every movement. Pick one to see step-by-step instructions."
        actions={
          <Link href="/workouts">
            <Button variant="secondary">Back to workouts</Button>
          </Link>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Search" htmlFor="ex-q">
            <Input
              id="ex-q"
              type="search"
              placeholder="e.g. squat, chest, dumbbell…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search exercises"
            />
          </Field>
          <Field label="Muscle group" htmlFor="ex-muscle">
            <Select id="ex-muscle" value={muscle} onChange={(e) => setMuscle(e.target.value)}>
              <option value={ALL}>All muscle groups</option>
              {muscles.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Equipment" htmlFor="ex-equipment">
            <Select id="ex-equipment" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              <option value={ALL}>Any equipment</option>
              {equipments.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Difficulty" htmlFor="ex-difficulty">
            <Select id="ex-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value={ALL}>Any difficulty</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Select>
          </Field>
          <Field label="Training style" htmlFor="ex-style">
            <Select id="ex-style" value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value={ALL}>Any style</option>
              {styles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location" htmlFor="ex-location">
            <Select id="ex-location" value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value={ALL}>Home &amp; gym</option>
              <option value="home">Home friendly</option>
              <option value="gym">Gym</option>
            </Select>
          </Field>
        </div>
        {hasFilters ? (
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear all filters
            </Button>
          </div>
        ) : null}
      </Card>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading exercises">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Couldn't load exercises"
          message={error}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Retry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No exercises match those filters" : "No exercises yet"}
          message={
            hasFilters
              ? "Try widening your search or clearing a filter or two."
              : "The exercise library is empty right now — check back soon."
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400" role="status">
            {filtered.length} {filtered.length === 1 ? "exercise" : "exercises"}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <li key={e.slug}>
                <Link
                  href={`/workouts/library/${e.slug}`}
                  className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label={`View ${e.name} technique guide`}
                >
                  <Card className="flex h-full flex-col gap-2 transition-shadow hover:shadow-md">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {e.name}
                      </h3>
                      <Badge tone={difficultyTone(e.difficulty)}>{e.difficulty}</Badge>
                    </div>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      <span className="font-medium">Muscles:</span>{" "}
                      {asStringArray(e.muscleGroups).join(", ") || "—"}
                    </p>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      <span className="font-medium">Equipment:</span>{" "}
                      {asStringArray(e.equipment).join(", ") || "—"}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                      {e.homeSuitable ? <Badge>Home</Badge> : null}
                      {e.gymSuitable ? <Badge>Gym</Badge> : null}
                      {asStringArray(e.trainingStyles)
                        .slice(0, 3)
                        .map((s) => (
                          <Badge key={s} tone="blue">
                            {s}
                          </Badge>
                        ))}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
