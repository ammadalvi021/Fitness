/**
 * Aerobics guided-workout player state machine (V22 Phase C).
 *
 * Pure TypeScript — no React, no timers, no I/O — a sibling to the yoga
 * machine in `machine.ts`, with the same playback semantics (pause freezes
 * both the countdown and the elapsed clock, skip never counts, repeat
 * restarts the current segment, finish-early preserves partial counts)
 * but a simpler segment model:
 *  - each routine step becomes exactly ONE segment
 *  - NO bilateral (left/right) expansion
 *  - NO transition segments between steps
 *
 * Steps are played in phase order (warmup -> main -> cooldown; unknown
 * phases last), then by step `order` within a phase — the same ordering
 * GET /api/aerobics/routines/[slug] applies.
 *
 * Timing invariant: `elapsedSeconds` counts only seconds ticked while in
 * the "playing" phase — PAUSE freezes both the countdown and the elapsed
 * clock, because TICK is a no-op outside "playing".
 */

/* ------------------------------ Input types ------------------------------ */

export interface AerobicsStepInput {
  order: number;
  /** warmup | main | cooldown (unknown values are tolerated, sorted last). */
  phase: string;
  name: string;
  durationSeconds: number;
  cue?: string | null;
  lowImpactAlternative?: string | null;
}

/** Structural shape of GET /api/aerobics/routines/[slug]'s `routine`. */
export interface AerobicsRoutineInput {
  slug: string;
  title: string;
  steps: AerobicsStepInput[];
}

/* ----------------------------- Segment types ----------------------------- */

export interface AerobicsSegment {
  kind: 'step';
  durationSeconds: number;
  /** Index of this step among all segments (0-based). */
  stepIndex: number;
  stepName: string;
  cue: string | null;
  lowImpactAlternative: string | null;
  /** Raw phase string from the step (e.g. "warmup"). */
  phase: string;
  /** "Warm-up" | "Main" | "Cool-down"; falls back to the raw phase string. */
  phaseLabel: string;
}

/* ------------------------------ State machine ---------------------------- */

export type AerobicsPlayerPhase = 'ready' | 'playing' | 'paused' | 'complete';

export interface AerobicsPlayerState {
  phase: AerobicsPlayerPhase;
  segments: AerobicsSegment[];
  /** Index into `segments` of the segment currently on screen. */
  currentIndex: number;
  /** Seconds left in the current segment. */
  remainingSeconds: number;
  /** Active (non-paused) seconds elapsed since START. */
  elapsedSeconds: number;
  /** Steps finished naturally. Skips don't count. */
  completedSteps: number;
  /** Total step segments in the session. */
  totalSteps: number;
}

export type AerobicsPlayerEvent =
  | { type: 'START' }
  | { type: 'TICK' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SKIP' }
  | { type: 'REPEAT' }
  | { type: 'FINISH_EARLY' };

const PHASE_ORDER: Record<string, number> = { warmup: 0, main: 1, cooldown: 2 };

const PHASE_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  main: 'Main',
  cooldown: 'Cool-down',
};

/**
 * Expand a routine detail (API shape) into playable segments: steps sorted
 * by phase order, then step order; one segment per step.
 */
export function buildAerobicsSegments(
  routine: AerobicsRoutineInput,
): AerobicsSegment[] {
  const steps = [...(routine.steps ?? [])].sort(
    (a, b) =>
      (PHASE_ORDER[a.phase] ?? 99) - (PHASE_ORDER[b.phase] ?? 99) ||
      a.order - b.order,
  );
  return steps.map((step, stepIndex) => ({
    kind: 'step' as const,
    durationSeconds: Math.max(0, Math.round(step.durationSeconds)),
    stepIndex,
    stepName: step.name,
    cue: step.cue ?? null,
    lowImpactAlternative: step.lowImpactAlternative ?? null,
    phase: step.phase,
    phaseLabel: PHASE_LABELS[step.phase] ?? step.phase,
  }));
}

/** Total duration of a segment list in seconds: the plain segment sum. */
export function totalDurationSeconds(segments: AerobicsSegment[]): number {
  let total = 0;
  for (const segment of segments) total += segment.durationSeconds;
  return total;
}

/** Initial state for a built segment list (phase "ready", nothing elapsed). */
export function createMachine(segments: AerobicsSegment[]): AerobicsPlayerState {
  return {
    phase: 'ready',
    segments,
    currentIndex: 0,
    remainingSeconds: segments[0]?.durationSeconds ?? 0,
    elapsedSeconds: 0,
    completedSteps: 0,
    totalSteps: segments.length,
  };
}

export function currentSegment(state: AerobicsPlayerState): AerobicsSegment | null {
  return state.segments[state.currentIndex] ?? null;
}

/** The segment after the current one, or null when the current is the last. */
export function nextSegment(state: AerobicsPlayerState): AerobicsSegment | null {
  return state.segments[state.currentIndex + 1] ?? null;
}

/** Move to segment `index` (or complete when past the end). No count changes. */
function advanceTo(state: AerobicsPlayerState, index: number): AerobicsPlayerState {
  if (index >= state.segments.length) {
    return { ...state, phase: 'complete', remainingSeconds: 0 };
  }
  const segment = state.segments[index];
  // Skipping while paused lands on the next segment still paused; skipping
  // while playing keeps playing.
  return {
    ...state,
    currentIndex: index,
    remainingSeconds: segment.durationSeconds,
  };
}

/** Finish the current segment naturally (count it) and move on. */
function finishCurrentSegment(state: AerobicsPlayerState): AerobicsPlayerState {
  const counted: AerobicsPlayerState = {
    ...state,
    completedSteps: state.completedSteps + 1,
  };
  return advanceTo(counted, state.currentIndex + 1);
}

export function reduce(
  state: AerobicsPlayerState,
  event: AerobicsPlayerEvent,
): AerobicsPlayerState {
  switch (event.type) {
    case 'START': {
      if (state.phase !== 'ready') return state;
      if (state.segments.length === 0) {
        return { ...state, phase: 'complete', remainingSeconds: 0 };
      }
      return {
        ...state,
        phase: 'playing',
        currentIndex: 0,
        remainingSeconds: state.segments[0].durationSeconds,
      };
    }

    case 'TICK': {
      // Paused / ready / complete: frozen — no countdown, no elapsed time.
      if (state.phase !== 'playing') return state;
      const ticked: AerobicsPlayerState = {
        ...state,
        elapsedSeconds: state.elapsedSeconds + 1,
      };
      if (state.remainingSeconds > 1) {
        return { ...ticked, remainingSeconds: state.remainingSeconds - 1 };
      }
      // This tick consumes the segment's final second.
      return finishCurrentSegment(ticked);
    }

    case 'PAUSE': {
      if (state.phase !== 'playing') return state;
      return { ...state, phase: 'paused' };
    }

    case 'RESUME': {
      if (state.phase !== 'paused') return state;
      return { ...state, phase: 'playing' };
    }

    case 'SKIP': {
      if (state.phase !== 'playing' && state.phase !== 'paused') return state;
      // Skipping never counts the step as completed; skipping the final
      // step completes the session with partial counts.
      return advanceTo(state, state.currentIndex + 1);
    }

    case 'REPEAT': {
      if (state.phase !== 'playing' && state.phase !== 'paused') return state;
      const segment = state.segments[state.currentIndex];
      if (!segment) return state;
      // Restart the current step at full duration. It has not been counted
      // yet (counting happens only on natural finish), so no counts change
      // and finishing it after the repeat counts it exactly once.
      return { ...state, remainingSeconds: segment.durationSeconds };
    }

    case 'FINISH_EARLY': {
      if (state.phase === 'complete') return state;
      return { ...state, phase: 'complete' };
    }

    default:
      return state;
  }
}
