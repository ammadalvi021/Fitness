/**
 * Guided-workout player state machine (Yoga & Aerobics, V22 Phase B).
 *
 * Pure TypeScript — no React, no timers, no I/O — so the full playback
 * behaviour (hold/transition sequencing, pause freezing, skip/repeat,
 * early finish) is unit-testable. The React player drives it with a 1s
 * interval that dispatches TICK; rendering reads the state only.
 *
 * Segment model: a sequence's poses are expanded into HOLD segments and
 * TRANSITION segments:
 *  - side "each"  -> two hold segments (left, then right), each holdSeconds
 *  - side "left" / "right" -> one hold segment labelled with that side
 *  - side "both" (or anything else) -> one unlabelled hold segment
 *  - between two poses, one transition segment of the INCOMING pose's
 *    transitionSeconds ("get ready" time). Zero/negative transitions are
 *    not inserted.
 *
 * Timing invariant: `elapsedSeconds` counts only seconds ticked while in
 * the holding/transition phases — PAUSE freezes both the countdown and
 * the elapsed clock, because TICK is a no-op outside active phases.
 */

/* ------------------------------ Input types ------------------------------ */

export interface MachinePoseInput {
  slug: string;
  name: string;
  sanskritName?: string | null;
  /** Prisma Json: expected to be an array of instruction strings. */
  instructions?: unknown;
  breathing?: string | null;
  modifications?: string | null;
  cautions?: string | null;
  difficulty?: string | null;
  mediaStatus?: string | null;
}

export interface MachineStepInput {
  order: number;
  holdSeconds: number;
  /** both | left | right | each */
  side: string;
  transitionSeconds: number;
  cue?: string | null;
  pose: MachinePoseInput;
}

/** Structural shape of GET /api/yoga/sequences/[slug]'s `sequence`. */
export interface MachineSequenceInput {
  slug: string;
  title: string;
  poses: MachineStepInput[];
}

/* ----------------------------- Segment types ----------------------------- */

export type SegmentKind = "hold" | "transition";
export type SegmentSide = "both" | "left" | "right";

export interface PlayerSegment {
  kind: SegmentKind;
  durationSeconds: number;
  /** Hold segments only: index of this hold among all holds (0-based). */
  holdIndex: number | null;
  poseSlug: string | null;
  poseName: string | null;
  sanskritName: string | null;
  /** Hold segments only; null on transitions. */
  side: SegmentSide | null;
  /** "Left side" / "Right side" for single-side holds, else null. */
  sideLabel: string | null;
  instructions: string[];
  breathing: string | null;
  modifications: string | null;
  cautions: string | null;
  cue: string | null;
  mediaStatus: string | null;
  /**
   * Transition segments only: index (into the segments array) of the hold
   * segment this transition leads into — powers the "Get ready" preview.
   */
  nextSegmentIndex: number | null;
}

/* ------------------------------ State machine ---------------------------- */

export type PlayerPhase =
  | "ready"
  | "holding"
  | "transition"
  | "paused"
  | "complete";

export type ActivePhase = "holding" | "transition";

export interface PlayerState {
  phase: PlayerPhase;
  segments: PlayerSegment[];
  /** Index into `segments` of the segment currently on screen. */
  currentIndex: number;
  /** Seconds left in the current segment. */
  remainingSeconds: number;
  /** Active (non-paused) seconds elapsed since START. */
  elapsedSeconds: number;
  /** Segments finished naturally (holds + transitions). Skips don't count. */
  completedSegments: number;
  /** Hold segments finished naturally. Skips don't count. */
  completedHolds: number;
  /** Total hold segments in the session. */
  totalHolds: number;
  /** Phase to return to on RESUME; set only while paused. */
  resumePhase: ActivePhase | null;
}

export type PlayerEvent =
  | { type: "START" }
  | { type: "TICK" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "SKIP" }
  | { type: "REPEAT" }
  | { type: "FINISH_EARLY" };

function phaseForSegment(segment: PlayerSegment | undefined): ActivePhase {
  return segment && segment.kind === "transition" ? "transition" : "holding";
}

function asInstructions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/**
 * Expand a sequence detail (API shape) into playable segments.
 * Steps are sorted by `order` defensively; the API already orders them.
 */
export function buildSegments(sequence: MachineSequenceInput): PlayerSegment[] {
  const steps = [...(sequence.poses ?? [])].sort((a, b) => a.order - b.order);
  const segments: PlayerSegment[] = [];
  let holdCount = 0;

  const pushHold = (step: MachineStepInput, side: SegmentSide) => {
    segments.push({
      kind: "hold",
      durationSeconds: Math.max(0, Math.round(step.holdSeconds)),
      holdIndex: holdCount,
      poseSlug: step.pose.slug,
      poseName: step.pose.name,
      sanskritName: step.pose.sanskritName ?? null,
      side,
      sideLabel: side === "left" ? "Left side" : side === "right" ? "Right side" : null,
      instructions: asInstructions(step.pose.instructions),
      breathing: step.pose.breathing ?? null,
      modifications: step.pose.modifications ?? null,
      cautions: step.pose.cautions ?? null,
      cue: step.cue ?? null,
      mediaStatus: step.pose.mediaStatus ?? null,
      nextSegmentIndex: null,
    });
    holdCount += 1;
  };

  steps.forEach((step, i) => {
    if (i > 0 && step.transitionSeconds > 0) {
      segments.push({
        kind: "transition",
        durationSeconds: Math.round(step.transitionSeconds),
        holdIndex: null,
        poseSlug: step.pose.slug,
        poseName: step.pose.name,
        sanskritName: step.pose.sanskritName ?? null,
        side: null,
        sideLabel: null,
        instructions: [],
        breathing: null,
        modifications: null,
        cautions: null,
        cue: step.cue ?? null,
        mediaStatus: step.pose.mediaStatus ?? null,
        // Filled in below, once the following hold exists.
        nextSegmentIndex: null,
      });
    }
    if (step.side === "each") {
      pushHold(step, "left");
      pushHold(step, "right");
    } else if (step.side === "left" || step.side === "right") {
      pushHold(step, step.side);
    } else {
      pushHold(step, "both");
    }
  });

  // Point every transition at the hold segment that follows it.
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].kind === "transition") {
      const nextHold = segments.findIndex((s, j) => j > i && s.kind === "hold");
      segments[i].nextSegmentIndex = nextHold === -1 ? null : nextHold;
    }
  }
  return segments;
}

/** Initial state for a built segment list (phase "ready", nothing elapsed). */
export function createMachine(segments: PlayerSegment[]): PlayerState {
  return {
    phase: "ready",
    segments,
    currentIndex: 0,
    remainingSeconds: segments[0]?.durationSeconds ?? 0,
    elapsedSeconds: 0,
    completedSegments: 0,
    completedHolds: 0,
    totalHolds: segments.filter((s) => s.kind === "hold").length,
    resumePhase: null,
  };
}

export function currentSegment(state: PlayerState): PlayerSegment | null {
  return state.segments[state.currentIndex] ?? null;
}

/**
 * The next HOLD segment after the current one (for the next-pose preview),
 * or null when the current hold is the last.
 */
export function nextHoldSegment(state: PlayerState): PlayerSegment | null {
  for (let i = state.currentIndex + 1; i < state.segments.length; i++) {
    if (state.segments[i].kind === "hold") return state.segments[i];
  }
  return null;
}

/** Move to segment `index` (or complete when past the end). No count changes. */
function advanceTo(state: PlayerState, index: number): PlayerState {
  if (index >= state.segments.length) {
    return { ...state, phase: "complete", remainingSeconds: 0, resumePhase: null };
  }
  const segment = state.segments[index];
  const base: PlayerState = {
    ...state,
    currentIndex: index,
    remainingSeconds: segment.durationSeconds,
  };
  if (state.phase === "paused") {
    return { ...base, resumePhase: phaseForSegment(segment) };
  }
  return { ...base, phase: phaseForSegment(segment) };
}

/** Finish the current segment naturally (count it) and move on. */
function finishCurrentSegment(state: PlayerState): PlayerState {
  const segment = state.segments[state.currentIndex];
  const counted: PlayerState = {
    ...state,
    completedSegments: state.completedSegments + 1,
    completedHolds:
      state.completedHolds + (segment && segment.kind === "hold" ? 1 : 0),
  };
  return advanceTo(counted, state.currentIndex + 1);
}

/** Index of the nearest hold segment strictly before `index`, or -1. */
function previousHoldIndex(state: PlayerState, index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (state.segments[i].kind === "hold") return i;
  }
  return -1;
}

/**
 * REPEAT behaviour shared by active and paused states: restart the current
 * hold at full duration; from a transition, go back to the previous hold
 * (un-completing it, since it will be played — and counted — again).
 */
function repeatCurrent(state: PlayerState, fromPhase: ActivePhase): PlayerState {
  const segment = state.segments[state.currentIndex];
  if (!segment) return state;
  if (fromPhase === "holding") {
    return { ...state, remainingSeconds: segment.durationSeconds };
  }
  // From a transition: step back to the previous hold segment.
  const prev = previousHoldIndex(state, state.currentIndex);
  if (prev === -1) {
    return { ...state, remainingSeconds: segment.durationSeconds };
  }
  const hold = state.segments[prev];
  const rewound: PlayerState = {
    ...state,
    currentIndex: prev,
    remainingSeconds: hold.durationSeconds,
    // The previous hold was counted when it finished; this transition has
    // not finished yet, so only the hold is un-counted. Re-finishing the
    // hold later counts it exactly once again.
    completedSegments: Math.max(0, state.completedSegments - 1),
    completedHolds: Math.max(0, state.completedHolds - 1),
  };
  if (state.phase === "paused") {
    return { ...rewound, resumePhase: "holding" };
  }
  return { ...rewound, phase: "holding" };
}

export function reduce(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case "START": {
      if (state.phase !== "ready") return state;
      if (state.segments.length === 0) {
        return { ...state, phase: "complete", remainingSeconds: 0 };
      }
      return {
        ...state,
        currentIndex: 0,
        remainingSeconds: state.segments[0].durationSeconds,
        phase: phaseForSegment(state.segments[0]),
      };
    }

    case "TICK": {
      // Paused / ready / complete: frozen — no countdown, no elapsed time.
      if (state.phase !== "holding" && state.phase !== "transition") {
        return state;
      }
      const ticked: PlayerState = {
        ...state,
        elapsedSeconds: state.elapsedSeconds + 1,
      };
      if (state.remainingSeconds > 1) {
        return { ...ticked, remainingSeconds: state.remainingSeconds - 1 };
      }
      // This tick consumes the segment's final second.
      return finishCurrentSegment(ticked);
    }

    case "PAUSE": {
      if (state.phase !== "holding" && state.phase !== "transition") {
        return state;
      }
      return { ...state, phase: "paused", resumePhase: state.phase };
    }

    case "RESUME": {
      if (state.phase !== "paused") return state;
      return {
        ...state,
        phase: state.resumePhase ?? "holding",
        resumePhase: null,
      };
    }

    case "SKIP": {
      if (
        state.phase !== "holding" &&
        state.phase !== "transition" &&
        state.phase !== "paused"
      ) {
        return state;
      }
      // Skipping never counts the segment as completed; skipping the final
      // segment completes the session with partial counts.
      return advanceTo(state, state.currentIndex + 1);
    }

    case "REPEAT": {
      if (state.phase === "holding" || state.phase === "transition") {
        return repeatCurrent(state, state.phase);
      }
      if (state.phase === "paused" && state.resumePhase) {
        return repeatCurrent(state, state.resumePhase);
      }
      return state;
    }

    case "FINISH_EARLY": {
      if (state.phase === "complete") return state;
      return { ...state, phase: "complete", resumePhase: null };
    }

    default:
      return state;
  }
}
