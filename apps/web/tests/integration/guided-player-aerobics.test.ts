/**
 * Aerobics guided player state machine (V22 Phase C) — pure unit tests,
 * no DB. Covers phase ordering from shuffled input, one segment per step
 * (no transitions, no bilateral expansion), segment field carriage, total
 * duration (vs @fitfusion/core routineDurationSeconds), pause/resume
 * freezing, skip, repeat, natural completion, finish-early partial
 * counts, and elapsed-time semantics.
 */
import { describe, expect, it } from 'vitest';
import { routineDurationSeconds } from '@fitfusion/core';
import {
  buildAerobicsSegments,
  createMachine,
  currentSegment,
  nextSegment,
  reduce,
  totalDurationSeconds,
  type AerobicsPlayerState,
  type AerobicsRoutineInput,
} from '@/lib/guided-player/aerobics-machine';

/** Deliberately shuffled: phases and orders are NOT in play order. */
const ROUTINE: AerobicsRoutineInput = {
  slug: 'test-aerobics',
  title: 'Test Aerobics',
  steps: [
    { order: 3, phase: 'main', name: 'Step Touch', durationSeconds: 120, cue: 'Step out and touch', lowImpactAlternative: 'Smaller steps' },
    { order: 2, phase: 'cooldown', name: 'Deep Breathing', durationSeconds: 60, cue: null, lowImpactAlternative: null },
    { order: 2, phase: 'warmup', name: 'Easy Side Steps', durationSeconds: 45, cue: 'Knees soft', lowImpactAlternative: null },
    { order: 1, phase: 'main', name: 'March & Reach', durationSeconds: 60, cue: 'Reach up and across', lowImpactAlternative: 'Shoulder height only' },
    { order: 1, phase: 'warmup', name: 'March in Place', durationSeconds: 30, cue: 'Start gently', lowImpactAlternative: null },
    { order: 1, phase: 'cooldown', name: 'Easy March', durationSeconds: 30, cue: null, lowImpactAlternative: null },
  ],
};

function started(segments = buildAerobicsSegments(ROUTINE)): AerobicsPlayerState {
  return reduce(createMachine(segments), { type: 'START' });
}

function tick(state: AerobicsPlayerState, n: number): AerobicsPlayerState {
  let s = state;
  for (let i = 0; i < n; i++) s = reduce(s, { type: 'TICK' });
  return s;
}

describe('buildAerobicsSegments', () => {
  it('orders steps by phase (warmup -> main -> cooldown), then by step order, from shuffled input', () => {
    const segments = buildAerobicsSegments(ROUTINE);
    expect(segments.map((s) => s.stepName)).toEqual([
      'March in Place',
      'Easy Side Steps',
      'March & Reach',
      'Step Touch',
      'Easy March',
      'Deep Breathing',
    ]);
    expect(segments.map((s) => s.phase)).toEqual([
      'warmup',
      'warmup',
      'main',
      'main',
      'cooldown',
      'cooldown',
    ]);
    expect(segments.map((s) => s.stepIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('creates exactly one segment per step — no transitions, no bilateral expansion', () => {
    const segments = buildAerobicsSegments(ROUTINE);
    expect(segments).toHaveLength(ROUTINE.steps.length);
    expect(segments.every((s) => s.kind === 'step')).toBe(true);
  });

  it('carries name/cue/lowImpactAlternative and maps phase labels', () => {
    const segments = buildAerobicsSegments(ROUTINE);
    const stepTouch = segments.find((s) => s.stepName === 'Step Touch');
    expect(stepTouch?.cue).toBe('Step out and touch');
    expect(stepTouch?.lowImpactAlternative).toBe('Smaller steps');
    expect(stepTouch?.phaseLabel).toBe('Main');
    expect(segments[0].phaseLabel).toBe('Warm-up');
    expect(segments[0].cue).toBe('Start gently');
    expect(segments[0].lowImpactAlternative).toBeNull();
    const breathing = segments.find((s) => s.stepName === 'Deep Breathing');
    expect(breathing?.phaseLabel).toBe('Cool-down');
    expect(breathing?.cue).toBeNull();
    expect(breathing?.lowImpactAlternative).toBeNull();
  });

  it('sorts unknown phases last and falls back to the raw phase string as the label', () => {
    const segments = buildAerobicsSegments({
      slug: 'x',
      title: 'X',
      steps: [
        { order: 1, phase: 'finisher', name: 'Finisher', durationSeconds: 10 },
        { order: 1, phase: 'warmup', name: 'Warm', durationSeconds: 10 },
      ],
    });
    expect(segments.map((s) => s.stepName)).toEqual(['Warm', 'Finisher']);
    expect(segments[1].phaseLabel).toBe('finisher');
  });

  it('total duration equals the segment sum and routineDurationSeconds from core', () => {
    const segments = buildAerobicsSegments(ROUTINE);
    const expected = ROUTINE.steps.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(totalDurationSeconds(segments)).toBe(expected);
    expect(totalDurationSeconds(segments)).toBe(routineDurationSeconds(ROUTINE.steps));
    expect(totalDurationSeconds(segments)).toBe(345);
    expect(totalDurationSeconds([])).toBe(0);
  });
});

describe('playback', () => {
  it('START enters the first step playing with its full duration', () => {
    const s = started();
    expect(s.phase).toBe('playing');
    expect(s.currentIndex).toBe(0);
    expect(s.remainingSeconds).toBe(30);
    expect(s.totalSteps).toBe(6);
    expect(s.completedSteps).toBe(0);
    expect(currentSegment(s)?.stepName).toBe('March in Place');
    expect(nextSegment(s)?.stepName).toBe('Easy Side Steps');
  });

  it('TICK counts down, counts elapsed, and advances to the next step counting the finished one', () => {
    let s = started();
    s = tick(s, 29);
    expect(s.remainingSeconds).toBe(1);
    expect(s.elapsedSeconds).toBe(29);
    expect(s.phase).toBe('playing');
    expect(s.completedSteps).toBe(0);
    s = tick(s, 1);
    expect(s.phase).toBe('playing');
    expect(s.currentIndex).toBe(1);
    expect(s.remainingSeconds).toBe(45);
    expect(s.elapsedSeconds).toBe(30);
    expect(s.completedSteps).toBe(1);
    expect(currentSegment(s)?.stepName).toBe('Easy Side Steps');
  });

  it('PAUSE freezes countdown and elapsed; RESUME returns to playing', () => {
    let s = tick(started(), 10);
    const frozenRemaining = s.remainingSeconds;
    const frozenElapsed = s.elapsedSeconds;
    s = reduce(s, { type: 'PAUSE' });
    expect(s.phase).toBe('paused');
    s = tick(s, 10);
    expect(s.remainingSeconds).toBe(frozenRemaining);
    expect(s.elapsedSeconds).toBe(frozenElapsed);
    s = reduce(s, { type: 'RESUME' });
    expect(s.phase).toBe('playing');
    s = tick(s, 1);
    expect(s.elapsedSeconds).toBe(frozenElapsed + 1);
    expect(s.remainingSeconds).toBe(frozenRemaining - 1);
  });

  it('SKIP advances without counting the step; skipping the last step completes', () => {
    let s = started();
    s = reduce(s, { type: 'SKIP' });
    expect(s.phase).toBe('playing');
    expect(s.currentIndex).toBe(1);
    expect(s.remainingSeconds).toBe(45);
    expect(s.completedSteps).toBe(0);
    for (let i = 0; i < 20 && s.phase !== 'complete'; i++) {
      s = reduce(s, { type: 'SKIP' });
    }
    expect(s.phase).toBe('complete');
    expect(s.completedSteps).toBe(0);
    expect(nextSegment(s)).toBeNull();
  });

  it('REPEAT restarts the current step at full duration without changing counts, and re-finishing counts once', () => {
    let s = tick(started(), 42); // step 1 done (30s), 12s into step 2
    expect(s.completedSteps).toBe(1);
    expect(s.remainingSeconds).toBe(33);
    s = reduce(s, { type: 'REPEAT' });
    expect(s.phase).toBe('playing');
    expect(s.currentIndex).toBe(1);
    expect(s.remainingSeconds).toBe(45);
    expect(s.completedSteps).toBe(1);
    // Finishing the repeated step counts it exactly once.
    s = tick(s, 45);
    expect(s.completedSteps).toBe(2);
    expect(s.currentIndex).toBe(2);
  });

  it('completes naturally after the final step with all steps counted', () => {
    const total = totalDurationSeconds(buildAerobicsSegments(ROUTINE));
    const s = tick(started(), total);
    expect(s.phase).toBe('complete');
    expect(s.elapsedSeconds).toBe(total);
    expect(s.completedSteps).toBe(6);
    expect(s.totalSteps).toBe(6);
    // Ticks after completion are no-ops.
    const after = tick(s, 5);
    expect(after.elapsedSeconds).toBe(total);
    expect(after.phase).toBe('complete');
  });

  it('FINISH_EARLY completes preserving elapsed and completed counts', () => {
    let s = tick(started(), 75); // steps 1+2 done (30+45), at step 3 start
    expect(s.completedSteps).toBe(2);
    s = reduce(s, { type: 'FINISH_EARLY' });
    expect(s.phase).toBe('complete');
    expect(s.completedSteps).toBe(2);
    expect(s.elapsedSeconds).toBe(75);
  });

  it('an empty routine completes on START', () => {
    const s = reduce(createMachine(buildAerobicsSegments({ slug: 'e', title: 'E', steps: [] })), {
      type: 'START',
    });
    expect(s.phase).toBe('complete');
    expect(s.totalSteps).toBe(0);
    expect(s.completedSteps).toBe(0);
  });
});
