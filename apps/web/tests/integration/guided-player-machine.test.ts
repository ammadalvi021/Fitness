/**
 * Guided player state machine (V22 Phase B) — pure unit tests, no DB.
 * Covers segment expansion ('each' -> left then right), transition
 * insertion, pause/resume freezing, skip, repeat, natural completion,
 * finish-early partial counts, and elapsed-time semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSegments,
  createMachine,
  currentSegment,
  nextHoldSegment,
  reduce,
  type MachineSequenceInput,
  type PlayerState,
} from '@/lib/guided-player/machine';

function pose(slug: string, name: string) {
  return {
    slug,
    name,
    sanskritName: `${name} Sanskrit`,
    instructions: [`Enter ${name}`, `Hold ${name}`],
    breathing: 'Breathe steadily',
    modifications: 'Use a block',
    cautions: null,
    difficulty: 'beginner',
    mediaStatus: 'placeholder',
  };
}

const SEQUENCE: MachineSequenceInput = {
  slug: 'test-flow',
  title: 'Test Flow',
  poses: [
    { order: 1, holdSeconds: 30, side: 'both', transitionSeconds: 5, cue: null, pose: pose('mountain-pose', 'Mountain Pose') },
    { order: 2, holdSeconds: 20, side: 'each', transitionSeconds: 4, cue: 'Switch sides midway', pose: pose('tree-pose', 'Tree Pose') },
    { order: 3, holdSeconds: 10, side: 'left', transitionSeconds: 3, cue: null, pose: pose('eagle-pose', 'Eagle Pose') },
    { order: 4, holdSeconds: 15, side: 'both', transitionSeconds: 6, cue: null, pose: pose('corpse-pose', 'Corpse Pose') },
  ],
};

function started(segments = buildSegments(SEQUENCE)): PlayerState {
  return reduce(createMachine(segments), { type: 'START' });
}

function tick(state: PlayerState, n: number): PlayerState {
  let s = state;
  for (let i = 0; i < n; i++) s = reduce(s, { type: 'TICK' });
  return s;
}

describe('buildSegments', () => {
  it('expands "each" into left-then-right holds and inserts transitions between poses', () => {
    const segments = buildSegments(SEQUENCE);
    const shape = segments.map((s) =>
      s.kind === 'transition'
        ? `T${s.durationSeconds}`
        : `${s.poseName}:${s.side}:${s.durationSeconds}`,
    );
    expect(shape).toEqual([
      'Mountain Pose:both:30',
      'T4',
      'Tree Pose:left:20',
      'Tree Pose:right:20',
      'T3',
      'Eagle Pose:left:10',
      'T6',
      'Corpse Pose:both:15',
    ]);
  });

  it('labels single-side holds and points transitions at the next hold', () => {
    const segments = buildSegments(SEQUENCE);
    const left = segments.find((s) => s.poseName === 'Tree Pose' && s.side === 'left');
    const right = segments.find((s) => s.poseName === 'Tree Pose' && s.side === 'right');
    const eagle = segments.find((s) => s.kind === 'hold' && s.poseName === 'Eagle Pose');
    expect(left?.sideLabel).toBe('Left side');
    expect(right?.sideLabel).toBe('Right side');
    expect(eagle?.sideLabel).toBe('Left side');
    expect(segments[0].sideLabel).toBeNull();
    const transition = segments[1];
    expect(transition.kind).toBe('transition');
    expect(transition.nextSegmentIndex).toBe(2);
    expect(segments[2].poseName).toBe('Tree Pose');
    // Hold indices run across all holds in play order.
    expect(segments.filter((s) => s.kind === 'hold').map((s) => s.holdIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('skips zero-length transitions and carries pose guidance onto holds', () => {
    const segments = buildSegments({
      slug: 'x',
      title: 'X',
      poses: [
        { order: 1, holdSeconds: 5, side: 'both', transitionSeconds: 0, cue: null, pose: pose('a', 'A') },
        { order: 2, holdSeconds: 5, side: 'both', transitionSeconds: 0, cue: null, pose: pose('b', 'B') },
      ],
    });
    expect(segments).toHaveLength(2);
    expect(segments[0].instructions).toEqual(['Enter A', 'Hold A']);
    expect(segments[0].breathing).toBe('Breathe steadily');
    expect(segments[0].modifications).toBe('Use a block');
  });
});

describe('playback', () => {
  it('START enters the first hold with its full duration', () => {
    const s = started();
    expect(s.phase).toBe('holding');
    expect(s.currentIndex).toBe(0);
    expect(s.remainingSeconds).toBe(30);
    expect(s.totalHolds).toBe(5);
    expect(currentSegment(s)?.poseName).toBe('Mountain Pose');
    expect(nextHoldSegment(s)?.poseName).toBe('Tree Pose');
  });

  it('TICK counts down, counts elapsed, and advances into the transition', () => {
    let s = started();
    s = tick(s, 29);
    expect(s.remainingSeconds).toBe(1);
    expect(s.elapsedSeconds).toBe(29);
    expect(s.phase).toBe('holding');
    s = tick(s, 1);
    expect(s.phase).toBe('transition');
    expect(s.remainingSeconds).toBe(4);
    expect(s.elapsedSeconds).toBe(30);
    expect(s.completedSegments).toBe(1);
    expect(s.completedHolds).toBe(1);
    // Transition previews the incoming pose (Tree Pose, left side first).
    const seg = currentSegment(s);
    expect(seg?.poseName).toBe('Tree Pose');
    expect(nextHoldSegment(s)?.side).toBe('left');
  });

  it('PAUSE freezes countdown and elapsed; RESUME returns to the prior phase', () => {
    let s = started();
    s = tick(s, 35); // 30s hold + 4s transition + 1s into Tree (left)
    expect(s.phase).toBe('holding');
    expect(currentSegment(s)?.side).toBe('left');
    const frozenRemaining = s.remainingSeconds;
    const frozenElapsed = s.elapsedSeconds;
    s = reduce(s, { type: 'PAUSE' });
    expect(s.phase).toBe('paused');
    expect(s.resumePhase).toBe('holding');
    s = tick(s, 10);
    expect(s.remainingSeconds).toBe(frozenRemaining);
    expect(s.elapsedSeconds).toBe(frozenElapsed);
    s = reduce(s, { type: 'RESUME' });
    expect(s.phase).toBe('holding');
    s = tick(s, 1);
    expect(s.elapsedSeconds).toBe(frozenElapsed + 1);
  });

  it('PAUSE during a transition resumes into the transition', () => {
    let s = tick(started(), 30);
    expect(s.phase).toBe('transition');
    s = reduce(s, { type: 'PAUSE' });
    expect(s.resumePhase).toBe('transition');
    s = reduce(s, { type: 'RESUME' });
    expect(s.phase).toBe('transition');
  });

  it('SKIP advances without counting the segment; skipping the last completes', () => {
    let s = started();
    s = reduce(s, { type: 'SKIP' });
    expect(s.phase).toBe('transition');
    expect(s.completedSegments).toBe(0);
    expect(s.completedHolds).toBe(0);
    // Skip through everything.
    for (let i = 0; i < 20 && s.phase !== 'complete'; i++) {
      s = reduce(s, { type: 'SKIP' });
    }
    expect(s.phase).toBe('complete');
    expect(s.completedHolds).toBe(0);
    expect(s.completedSegments).toBe(0);
  });

  it('REPEAT restarts the current hold at full duration', () => {
    let s = tick(started(), 12);
    expect(s.remainingSeconds).toBe(18);
    s = reduce(s, { type: 'REPEAT' });
    expect(s.phase).toBe('holding');
    expect(s.currentIndex).toBe(0);
    expect(s.remainingSeconds).toBe(30);
    expect(s.completedHolds).toBe(0);
  });

  it('REPEAT from a transition returns to the previous hold and un-counts it', () => {
    let s = tick(started(), 30); // hold done, now in transition
    expect(s.completedHolds).toBe(1);
    expect(s.completedSegments).toBe(1);
    s = reduce(s, { type: 'REPEAT' });
    expect(s.phase).toBe('holding');
    expect(s.currentIndex).toBe(0);
    expect(s.remainingSeconds).toBe(30);
    expect(s.completedHolds).toBe(0);
    expect(s.completedSegments).toBe(0);
    // Finishing it again counts it exactly once.
    s = tick(s, 30);
    expect(s.completedHolds).toBe(1);
    expect(s.completedSegments).toBe(1);
  });

  it('completes naturally after the final segment with full counts', () => {
    const total = 30 + 4 + 20 + 20 + 3 + 10 + 6 + 15; // 108s
    const s = tick(started(), total);
    expect(s.phase).toBe('complete');
    expect(s.elapsedSeconds).toBe(total);
    expect(s.completedSegments).toBe(8);
    expect(s.completedHolds).toBe(5);
    // Ticks after completion are no-ops.
    const after = tick(s, 5);
    expect(after.elapsedSeconds).toBe(total);
    expect(after.phase).toBe('complete');
  });

  it('FINISH_EARLY completes with partial counts and elapsed so far', () => {
    let s = tick(started(), 34); // hold (30) + transition (4) done, at Tree-left start
    expect(s.completedHolds).toBe(1);
    expect(s.completedSegments).toBe(2);
    s = reduce(s, { type: 'FINISH_EARLY' });
    expect(s.phase).toBe('complete');
    expect(s.completedHolds).toBe(1);
    expect(s.completedSegments).toBe(2);
    expect(s.elapsedSeconds).toBe(34);
  });

  it('an empty segment list completes on START', () => {
    const s = reduce(createMachine([]), { type: 'START' });
    expect(s.phase).toBe('complete');
    expect(s.totalHolds).toBe(0);
  });
});
