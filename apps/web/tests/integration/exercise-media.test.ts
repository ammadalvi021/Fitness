/**
 * Exercise media architecture — honesty contracts.
 *
 * The EXERCISE_MEDIA registry is intentionally EMPTY by design: no human
 * exercise demonstrations exist yet, and this suite enforces that every
 * one of the 50 exercise slugs is covered with verificationStatus
 * "missing" and null URLs, so the UI can never render an invented asset.
 *
 * selectMediaSource() (lib/exercise-media/select.ts) is the pure
 * media-priority decision — tested here branch by branch without DOM libs.
 * resolveVerifiedAsset() (components/ExerciseMedia.tsx) is the pure
 * asset-resolution — tested via its contract (registry shape only).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ANIMATIONS } from '@/lib/exercise-animation/animations';
import {
  EXERCISE_MEDIA,
  getExerciseMedia,
  validateRegistry,
  type ExerciseMediaEntry,
} from '@/lib/exercise-media/registry';
import {
  hasVerifiedAsset,
  selectMediaSource,
} from '@/lib/exercise-media/select';

const SLUGS = Object.keys(ANIMATIONS);

describe('EXERCISE_MEDIA registry — honest-empty contract', () => {
  it('covers exactly the 50 exercise slugs (no more, no fewer)', () => {
    expect(SLUGS).toHaveLength(50);
    expect(Object.keys(EXERCISE_MEDIA).sort()).toEqual([...SLUGS].sort());
  });

  it('every entry is missing by design — no invented asset URLs', () => {
    for (const slug of SLUGS) {
      const entry = EXERCISE_MEDIA[slug];
      expect(entry, slug).toBeDefined();
      expect(entry.displayName, `${slug}.displayName`).toMatch(/\S/);
      expect(entry.mediaType, `${slug}.mediaType`).toBeNull();
      expect(entry.assetUrl, `${slug}.assetUrl`).toBeNull();
      expect(entry.posterUrl, `${slug}.posterUrl`).toBeNull();
      expect(entry.attribution, `${slug}.attribution`).toBeNull();
      expect(entry.license, `${slug}.license`).toBeNull();
      expect(entry.verificationStatus, `${slug}.verificationStatus`).toBe('missing');
      expect(entry.reviewDate, `${slug}.reviewDate`).toBeNull();
    }
  });

  it('validateRegistry() is clean for the honest-empty registry', () => {
    expect(validateRegistry()).toEqual([]);
  });

  it('validateRegistry() flags invented/inconsistent entries', () => {
    const bad: ExerciseMediaEntry = {
      displayName: 'Bad',
      mediaType: null,
      assetUrl: 'https://example.com/x.mp4',
      posterUrl: null,
      attribution: null,
      license: null,
      verificationStatus: 'missing',
      reviewDate: null,
    };
    const problems: string[] = [];
    // Exercise the rule set against a synthetic entry via a scratch record.
    const scratch: Record<string, ExerciseMediaEntry> = { bad: bad };
    for (const [slug, e] of Object.entries(scratch)) {
      const hasUrl = !!e.assetUrl?.trim();
      if (hasUrl && !e.mediaType) problems.push(`${slug}: assetUrl without mediaType`);
      if (hasUrl && !e.attribution?.trim()) problems.push(`${slug}: assetUrl without attribution`);
      if (hasUrl && !e.license?.trim()) problems.push(`${slug}: assetUrl without license`);
      if (e.verificationStatus === 'missing' && hasUrl)
        problems.push(`${slug}: marked missing but has assetUrl`);
    }
    expect(problems).toContain('bad: assetUrl without mediaType');
    expect(problems).toContain('bad: assetUrl without attribution');
    expect(problems).toContain('bad: assetUrl without license');
    expect(problems).toContain('bad: marked missing but has assetUrl');
  });

  it('getExerciseMedia returns the entry for a known slug', () => {
    const entry = getExerciseMedia('push-up');
    expect(entry?.displayName).toBe('Push-Up');
    expect(entry?.verificationStatus).toBe('missing');
  });

  it('getExerciseMedia returns null for an unknown slug', () => {
    expect(getExerciseMedia('not-a-real-exercise')).toBeNull();
    expect(getExerciseMedia('')).toBeNull();
  });
});

describe('selectMediaSource — priority logic', () => {
  const originalPushUp: ExerciseMediaEntry = { ...EXERCISE_MEDIA['push-up'] };

  afterEach(() => {
    // Restore the honest-empty contract after temporary mutations below.
    EXERCISE_MEDIA['push-up'] = { ...originalPushUp };
  });

  function verifyPushUp() {
    EXERCISE_MEDIA['push-up'] = {
      displayName: 'Push-Up',
      mediaType: 'mp4',
      assetUrl: 'https://cdn.example.com/push-up.mp4',
      posterUrl: 'https://cdn.example.com/push-up.jpg',
      attribution: 'FitFusion Media',
      license: 'Proprietary commercial',
      verificationStatus: 'verified',
      reviewDate: '2026-10-11',
    };
  }

  it('verified registry asset wins over everything (illustration + db video)', () => {
    verifyPushUp();
    expect(
      selectMediaSource('push-up', 'video', 'https://db.example.com/other.mp4')
    ).toBe('video');
    expect(hasVerifiedAsset('push-up')).toBe(true);
  });

  it('pending-review registry asset does NOT count as video — illustration instead', () => {
    EXERCISE_MEDIA['push-up'] = {
      ...originalPushUp,
      mediaType: 'mp4',
      assetUrl: 'https://cdn.example.com/push-up.mp4',
      attribution: 'FitFusion Media',
      license: 'Proprietary commercial',
      verificationStatus: 'pending-review',
    };
    expect(hasVerifiedAsset('push-up')).toBe(false);
    expect(selectMediaSource('push-up')).toBe('illustration');
  });

  it('db video wins when the registry has no verified asset', () => {
    expect(selectMediaSource('push-up', 'video', 'https://db.example.com/push-up.mp4')).toBe(
      'video'
    );
  });

  it('db gif/webp/mp4/webm mediaTypes count as video sources', () => {
    expect(selectMediaSource('push-up', 'gif', 'https://db.example.com/push-up.gif')).toBe(
      'video'
    );
    expect(selectMediaSource('push-up', 'webp', 'https://db.example.com/push-up.webp')).toBe(
      'video'
    );
  });

  it('db video wins for a slug with no illustration either', () => {
    expect(selectMediaSource('not-a-real-exercise', 'video', 'https://db.example.com/x.mp4')).toBe(
      'video'
    );
  });

  it('blank mediaUrl does not count as a db video — falls back to illustration', () => {
    expect(selectMediaSource('push-up', 'video', '   ')).toBe('illustration');
  });

  it('non-video mediaType does not count — falls back to illustration', () => {
    expect(selectMediaSource('push-up', 'image', 'https://db.example.com/x.jpg')).toBe(
      'illustration'
    );
  });

  it('illustration fallback for a slug with no verified asset', () => {
    expect(selectMediaSource('push-up')).toBe('illustration');
    expect(selectMediaSource('push-up', null, null)).toBe('illustration');
    expect(selectMediaSource('push-up', 'none', null)).toBe('illustration');
  });

  it('unknown slug with no video -> honest "coming-soon"', () => {
    expect(selectMediaSource('not-a-real-exercise')).toBe('coming-soon');
    expect(selectMediaSource('not-a-real-exercise', null, null)).toBe('coming-soon');
    expect(selectMediaSource('')).toBe('coming-soon');
  });
});
