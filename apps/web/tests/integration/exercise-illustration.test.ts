/**
 * Three-stage static illustrations — pure frame-selection contracts.
 *
 * illustrationFrames() (components/ExerciseIllustration.tsx) is pure
 * (no DOM), so the start / mid-rep / finish selection is unit-testable in
 * node. The component itself is a thin renderer over these frames.
 */
import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '@/lib/exercise-animation/animations';
import {
  hasExerciseIllustration,
  illustrationFrames,
} from '@/components/ExerciseIllustration';

const SLUGS = Object.keys(ANIMATIONS);

describe('illustrationFrames', () => {
  it('returns exactly three labeled frames for every exercise slug', () => {
    for (const slug of SLUGS) {
      const frames = illustrationFrames(slug);
      expect(frames, slug).not.toBeNull();
      expect(frames, slug).toHaveLength(3);
      expect(frames!.map((f) => f.label)).toEqual(['Start', 'Mid-rep', 'Finish']);
    }
  });

  it('every frame has finite joint coordinates inside the 200x200 viewBox', () => {
    for (const slug of SLUGS) {
      const frames = illustrationFrames(slug)!;
      for (const f of frames) {
        for (const [name, pt] of Object.entries(f.joints)) {
          expect(Number.isFinite(pt.x), `${slug}/${f.label}/${name}.x`).toBe(true);
          expect(Number.isFinite(pt.y), `${slug}/${f.label}/${name}.y`).toBe(true);
          // Generous bounds: rotated/offset poses may approach edges.
          expect(pt.x, `${slug}/${f.label}/${name}.x`).toBeGreaterThanOrEqual(-60);
          expect(pt.x, `${slug}/${f.label}/${name}.x`).toBeLessThanOrEqual(260);
          expect(pt.y, `${slug}/${f.label}/${name}.y`).toBeGreaterThanOrEqual(-60);
          expect(pt.y, `${slug}/${f.label}/${name}.y`).toBeLessThanOrEqual(260);
        }
      }
    }
  });

  it('mid-rep differs from start (the illustration shows movement phases)', () => {
    // Spot-check a few: the mid frame must not be identical to the start frame.
    for (const slug of ['bodyweight-squat', 'push-up', 'dumbbell-bicep-curl', 'burpee']) {
      const frames = illustrationFrames(slug)!;
      const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
      expect(same(frames[0].joints, frames[1].joints), `${slug} mid==start`).toBe(false);
    }
  });

  it('finish closes the loop back to the start pose', () => {
    for (const slug of SLUGS) {
      const frames = illustrationFrames(slug)!;
      expect(JSON.stringify(frames[2].joints), `${slug} finish!=start`).toBe(
        JSON.stringify(frames[0].joints)
      );
    }
  });

  it('returns null for an unknown slug', () => {
    expect(illustrationFrames('not-a-real-exercise')).toBeNull();
    expect(hasExerciseIllustration('not-a-real-exercise')).toBe(false);
  });

  it('hasExerciseIllustration is true for all 50 slugs', () => {
    for (const slug of SLUGS) {
      expect(hasExerciseIllustration(slug), slug).toBe(true);
    }
  });
});
