/**
 * Exercise media architecture — honesty contracts.
 *
 * The EXERCISE_MEDIA registry is intentionally EMPTY by design: no human
 * exercise videos exist yet, and this suite enforces that every one of the
 * 50 animation slugs is covered with { videoUrl: null, posterUrl: null },
 * so the UI can never render an invented video URL.
 *
 * selectMediaSource() (lib/exercise-media/select.ts) is the pure
 * media-priority decision — tested here branch by branch without DOM libs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ANIMATIONS } from '@/lib/exercise-animation/animations';
import {
  EXERCISE_MEDIA,
  getExerciseMedia,
  type ExerciseMediaEntry,
} from '@/lib/exercise-media/registry';
import { selectMediaSource } from '@/lib/exercise-media/select';

const SLUGS = Object.keys(ANIMATIONS);

describe('EXERCISE_MEDIA registry — honest-empty contract', () => {
  it('covers exactly the 50 animation slugs (no more, no fewer)', () => {
    expect(SLUGS).toHaveLength(50);
    expect(Object.keys(EXERCISE_MEDIA).sort()).toEqual([...SLUGS].sort());
  });

  it('every entry is empty by design — no invented video URLs', () => {
    for (const slug of SLUGS) {
      const entry = EXERCISE_MEDIA[slug];
      expect(entry, slug).toBeDefined();
      expect(entry.videoUrl, `${slug}.videoUrl`).toBeNull();
      expect(entry.posterUrl, `${slug}.posterUrl`).toBeNull();
    }
  });

  it('getExerciseMedia returns the entry for a known slug', () => {
    expect(getExerciseMedia('push-up')).toEqual({ videoUrl: null, posterUrl: null });
  });

  it('getExerciseMedia returns null for an unknown slug', () => {
    expect(getExerciseMedia('not-a-real-exercise')).toBeNull();
    expect(getExerciseMedia('')).toBeNull();
  });
});

describe('selectMediaSource — priority logic', () => {
  const originalPushUp: ExerciseMediaEntry = { ...EXERCISE_MEDIA['push-up'] };

  afterEach(() => {
    // Restore the honest-empty contract after the temporary mutation below.
    EXERCISE_MEDIA['push-up'] = { ...originalPushUp };
  });

  it('registry video wins over everything (animation + db video)', () => {
    EXERCISE_MEDIA['push-up'] = {
      videoUrl: 'https://cdn.example.com/push-up.mp4',
      posterUrl: 'https://cdn.example.com/push-up.jpg',
    };
    expect(selectMediaSource('push-up', 'video', 'https://db.example.com/other.mp4')).toBe('video');
  });

  it('db video wins when the registry has no video', () => {
    expect(selectMediaSource('push-up', 'video', 'https://db.example.com/push-up.mp4')).toBe('video');
  });

  it('db video wins for a slug with no animation either', () => {
    expect(selectMediaSource('not-a-real-exercise', 'video', 'https://db.example.com/x.mp4')).toBe(
      'video'
    );
  });

  it('blank mediaUrl does not count as a db video — falls back to animation', () => {
    expect(selectMediaSource('push-up', 'video', '   ')).toBe('animation');
  });

  it('non-video mediaType does not count — falls back to animation', () => {
    expect(selectMediaSource('push-up', 'image', 'https://db.example.com/x.jpg')).toBe('animation');
  });

  it('animation fallback for a slug with no video', () => {
    expect(selectMediaSource('push-up')).toBe('animation');
    expect(selectMediaSource('push-up', null, null)).toBe('animation');
    expect(selectMediaSource('push-up', 'none', null)).toBe('animation');
  });

  it('unknown slug with no video -> honest "coming-soon"', () => {
    expect(selectMediaSource('not-a-real-exercise')).toBe('coming-soon');
    expect(selectMediaSource('not-a-real-exercise', null, null)).toBe('coming-soon');
    expect(selectMediaSource('')).toBe('coming-soon');
  });
});
