import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import type { Exercise } from '@fitfusion/db';
import { routineDurationSeconds, sequenceDurationSeconds } from '@fitfusion/core';
import { requirePlan } from '@/lib/auth';
import { apiError, apiOk, parseDateOnly, readJson, startOfWeekMonday, toDateOnly, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const GenerateSchema = z.object({
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must be YYYY-MM-DD')
    .optional(),
});

const WORKOUT_SAFETY_NOTE =
  'Stop exercising and seek medical attention if you feel chest pain, dizziness, or unusual shortness of breath.';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeWorkoutDays(raw: string[]): number[] {
  const out = new Set<number>();
  for (const d of raw) {
    const v = d.trim().toLowerCase();
    const byName = DAY_NAMES.indexOf(v);
    if (byName >= 0) {
      out.add(byName);
      continue;
    }
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return [...out].sort();
}

type Focus = 'push' | 'pull' | 'legs' | 'full';

function focusOf(e: Exercise): Focus {
  const mg = e.muscleGroups.map((m) => m.toLowerCase()).join(' ');
  const has = (...words: string[]) => words.some((w) => mg.includes(w));
  if (has('chest', 'shoulder', 'tricep', 'push')) return 'push';
  if (has('back', 'bicep', 'lat', 'pull')) return 'pull';
  if (has('quad', 'hamstring', 'glute', 'calf', 'leg')) return 'legs';
  return 'full';
}

function equipmentAllowed(exercise: Exercise, userEquipment: string[]): boolean {
  const need = exercise.equipment.map((x) => x.toLowerCase());
  if (need.length === 0 || need.every((x) => x === 'bodyweight' || x === 'none')) return true;
  const have = new Set(userEquipment.map((x) => x.toLowerCase()));
  if (have.has('none') || have.has('bodyweight') || have.size === 0) {
    return need.every((x) => x === 'bodyweight' || x === 'none');
  }
  return need.every((x) => have.has(x));
}

interface PlannedExercise {
  exerciseId: string;
  slug: string;
  name: string;
  sets: number;
  reps: string;
  restSec: number;
  focus: Focus;
}

/**
 * POST /api/workouts/plans/generate — requires the "diet_exercise" plan.
 * Deterministic 7-day schedule from the Exercise library: workout days come
 * from the profile, other days are rest days.
 */
export async function POST(req: NextRequest) {
  const s = await requirePlan(req, 'diet_exercise');
  if (s instanceof NextResponse) return s;

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = GenerateSchema.safeParse(body.data ?? {});
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }

  const profile = s.profile;
  const workoutDayIdx = normalizeWorkoutDays(profile?.workoutDays ?? []);
  const activeDays = workoutDayIdx.length > 0 ? workoutDayIdx : [1, 3, 5]; // Mon/Wed/Fri default
  const userEquipment = profile?.equipment ?? [];
  const experience = (profile?.fitnessExperience ?? 'beginner').toLowerCase();
  const allowedDifficulties =
    experience === 'advanced'
      ? ['beginner', 'intermediate', 'advanced']
      : experience === 'intermediate'
        ? ['beginner', 'intermediate']
        : ['beginner'];
  const restrictions = (profile?.exerciseRestrictions ?? '').toLowerCase().split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const minutesPerDay = profile?.workoutMinutesPerDay ?? 45;
  const exercisesPerSession = Math.min(8, Math.max(4, Math.round(minutesPerDay / 8)));

  // --- Phase D: guided (yoga / aerobics) mixing ---------------------------
  // workoutTypes [] (or strength-only) => guidedKinds is empty and NONE of
  // the guided code below runs: the strength path is exactly the original
  // behaviour, with no extra queries and no reordered logic.
  type GuidedKind = 'yoga' | 'aerobics';
  interface GuidedEntry {
    kind: GuidedKind;
    slug: string;
    title: string;
    level: string;
    totalDurationSeconds: number;
  }
  const workoutTypes = profile?.workoutTypes ?? [];
  const guidedKinds: GuidedKind[] = (['yoga', 'aerobics'] as GuidedKind[]).filter((k) =>
    workoutTypes.includes(k),
  );
  const guidedEntriesByKind = new Map<GuidedKind, GuidedEntry[]>();
  if (guidedKinds.length > 0) {
    const targetSeconds = minutesPerDay * 60;
    // Deterministic candidate order: closest duration to the user's
    // minutes-per-day first, slug ascending as the tie-break.
    const byCloseness = (a: GuidedEntry, b: GuidedEntry) =>
      Math.abs(a.totalDurationSeconds - targetSeconds) -
        Math.abs(b.totalDurationSeconds - targetSeconds) ||
      a.slug.localeCompare(b.slug);
    // Level-appropriate: entry.level uses the same vocabulary as
    // fitnessExperience in the seeded catalogs (beginner/intermediate/
    // advanced — see seed-guided-data.ts), so allowedDifficulties applies
    // directly. Fall back to all entries of the kind if the filter empties.
    const levelFilter = (entries: GuidedEntry[]): GuidedEntry[] => {
      const lvl = entries.filter((e) => allowedDifficulties.includes(e.level.toLowerCase()));
      return lvl.length > 0 ? lvl : entries;
    };
    if (guidedKinds.includes('yoga')) {
      const sequences = await prisma.yogaSequence.findMany({
        include: { poses: true },
        orderBy: { slug: 'asc' },
      });
      const entries = levelFilter(
        sequences.map((seq) => ({
          kind: 'yoga' as GuidedKind,
          slug: seq.slug,
          title: seq.title,
          level: seq.level,
          totalDurationSeconds: sequenceDurationSeconds(seq.poses),
        })),
      ).sort(byCloseness);
      if (entries.length > 0) guidedEntriesByKind.set('yoga', entries);
    }
    if (guidedKinds.includes('aerobics')) {
      const routines = await prisma.aerobicRoutine.findMany({
        include: { steps: true },
        orderBy: { slug: 'asc' },
      });
      const entries = levelFilter(
        routines.map((r) => ({
          kind: 'aerobics' as GuidedKind,
          slug: r.slug,
          title: r.title,
          level: r.level,
          totalDurationSeconds: routineDurationSeconds(r.steps),
        })),
      ).sort(byCloseness);
      if (entries.length > 0) guidedEntriesByKind.set('aerobics', entries);
    }
  }
  // Kinds that actually have catalog entries to assign.
  const effectiveGuidedKinds = guidedKinds.filter((k) => guidedEntriesByKind.has(k));
  // Strength days are generated when strength was selected, or when there
  // is nothing guided to assign (including the empty-workoutTypes case).
  const strengthWillGenerate =
    workoutTypes.includes('strength') || effectiveGuidedKinds.length === 0;

  const library = await prisma.exercise.findMany({ orderBy: { slug: 'asc' } });
  const eligible = library.filter((e) => {
    if (!allowedDifficulties.includes(e.difficulty)) return false;
    if (!equipmentAllowed(e, userEquipment)) return false;
    if (restrictions.length > 0) {
      const hay = `${e.name} ${e.description} ${e.muscleGroups.join(' ')}`.toLowerCase();
      if (restrictions.some((r) => r.length > 2 && hay.includes(r))) return false;
    }
    return true;
  });

  // A guided-only profile must not be blocked by an empty strength library:
  // the 400 applies only when strength days will actually be generated.
  if (eligible.length === 0 && strengthWillGenerate) {
    return apiError(
      'no_exercises',
      'No exercises match your equipment and experience settings',
      400,
    );
  }

  const byFocus = new Map<Focus, Exercise[]>();
  for (const e of eligible) {
    const f = focusOf(e);
    if (!byFocus.has(f)) byFocus.set(f, []);
    byFocus.get(f)!.push(e);
  }
  const focusRotation: Focus[] = ['push', 'pull', 'legs', 'full'];
  const repsFor: Record<string, { sets: number; reps: string; restSec: number }> = {
    beginner: { sets: 3, reps: '10-12', restSec: 60 },
    intermediate: { sets: 4, reps: '8-12', restSec: 75 },
    advanced: { sets: 4, reps: '6-10', restSec: 90 },
  };
  const scheme = repsFor[experience] ?? repsFor.beginner;

  const weekStart = parsed.data.weekStart
    ? (parseDateOnly(parsed.data.weekStart) ?? startOfWeekMonday(new Date()))
    : startOfWeekMonday(new Date());

  // Deterministic rotation: session i takes the next `exercisesPerSession`
  // eligible exercises for its focus, wrapping around.
  const cursor = new Map<Focus, number>();
  const days: object[] = [];
  let sessionCount = 0;
  // Phase D counters — all stay at zero / unused when there are no guided
  // kinds, so the strength path below is unchanged in that case.
  // strengthSessionCount drives the focus rotation + exercise cursor, so
  // guided insertions never shift strength picks.
  let strengthSessionCount = 0;
  let guidedSessionCount = 0;
  let guidedDayCount = 0;
  const guidedKindsUsed: GuidedKind[] = [];
  const guidedEntryCursor = new Map<GuidedKind, number>();
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const date = new Date(weekStart.getTime() + dayIndex * 24 * 3600 * 1000);
    const dow = date.getUTCDay();
    if (!activeDays.includes(dow)) {
      days.push({
        dayIndex,
        date: toDateOnly(date),
        type: 'rest',
        note: 'Rest day — light walking, stretching, and good sleep support recovery.',
      });
      continue;
    }
    // Session index i = sessionCount (0-based among workout days only).
    // Mixed (strength also selected): guided on ODD i — every second
    // session. Guided-only: EVERY workout day is guided.
    const isGuided =
      effectiveGuidedKinds.length > 0 &&
      (!strengthWillGenerate || sessionCount % 2 === 1);
    if (isGuided) {
      // Cycle kinds in fixed order (yoga, then aerobics); entries
      // round-robin per kind through the duration-ordered candidates.
      const kind = effectiveGuidedKinds[guidedSessionCount % effectiveGuidedKinds.length];
      const entries = guidedEntriesByKind.get(kind)!;
      const entryIdx = guidedEntryCursor.get(kind) ?? 0;
      const entry = entries[entryIdx % entries.length];
      guidedEntryCursor.set(kind, entryIdx + 1);
      guidedSessionCount += 1;
      guidedDayCount += 1;
      if (!guidedKindsUsed.includes(kind)) guidedKindsUsed.push(kind);
      sessionCount += 1;
      days.push({
        dayIndex,
        date: toDateOnly(date),
        type: kind,
        title: entry.title,
        sourceSlug: entry.slug,
        durationSeconds: entry.totalDurationSeconds,
        note:
          kind === 'yoga'
            ? 'Guided yoga session — follow the pose-by-pose player.'
            : 'Guided aerobics session — follow the step-by-step player.',
      });
      continue;
    }
    const focus = focusRotation[strengthSessionCount % focusRotation.length];
    const pool = byFocus.get(focus) ?? eligible;
    const start = cursor.get(focus) ?? 0;
    const picked: PlannedExercise[] = [];
    for (let k = 0; k < exercisesPerSession && pool.length > 0; k++) {
      const e = pool[(start + k) % pool.length];
      picked.push({
        exerciseId: e.id,
        slug: e.slug,
        name: e.name,
        sets: scheme.sets,
        reps: scheme.reps,
        restSec: scheme.restSec,
        focus,
      });
    }
    cursor.set(focus, (start + exercisesPerSession) % pool.length);
    sessionCount += 1;
    strengthSessionCount += 1;
    days.push({
      dayIndex,
      date: toDateOnly(date),
      type: 'workout',
      focus,
      exercises: picked,
      note: 'Warm up 5-10 minutes before training and cool down afterwards.',
    });
  }

  const plan = await prisma.workoutPlan.create({
    data: {
      userId: s.user.id,
      weekStart,
      days: days as object,
      generatedBy: 'template',
    },
  });

  return apiOk(
    {
      plan,
      weekStart: toDateOnly(weekStart),
      notes: [
        WORKOUT_SAFETY_NOTE,
        `Schedule: ${sessionCount} workout day(s), ${7 - sessionCount} rest day(s).`,
        'Progress gradually — increase load or reps only when the current scheme feels manageable.',
        // Additive only: strength-only plans keep exactly the 3 notes above.
        ...(guidedDayCount > 0
          ? [
              `Includes ${guidedDayCount} guided day(s) (${guidedKindsUsed.join(', ')}) from your workout-type preferences.`,
            ]
          : []),
      ],
    },
    201,
  );
}
