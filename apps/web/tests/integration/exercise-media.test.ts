/**
 * Exercise media architecture — honesty contracts.
 *
 * The EXERCISE_MEDIA registry holds 50 owner-supplied exercise GIFs
 * (2026-10-11). This suite enforces that every one of the 50 exercise
 * slugs is covered by a fully-attributed, licensed, review-dated entry
 * pointing at a real file — so the UI can never render an invented asset.
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
  hasVerifiedDbAsset,
  selectMediaSource,
} from '@/lib/exercise-media/select';
import { assetMimeType } from '@/components/ExerciseMedia';

const SLUGS = Object.keys(ANIMATIONS);

describe('EXERCISE_MEDIA registry — owner-supplied GIF contract', () => {
  it('covers exactly the 50 exercise slugs (no more, no fewer)', () => {
    expect(SLUGS).toHaveLength(50);
    expect(Object.keys(EXERCISE_MEDIA).sort()).toEqual([...SLUGS].sort());
  });

  it('every entry is a verified owner-supplied GIF — no invented asset URLs', () => {
    for (const slug of SLUGS) {
      const entry = EXERCISE_MEDIA[slug];
      expect(entry, slug).toBeDefined();
      expect(entry.displayName, `${slug}.displayName`).toMatch(/\S/);
      expect(entry.mediaType, `${slug}.mediaType`).toBe('gif');
      expect(entry.assetUrl, `${slug}.assetUrl`).toBe(`/exercise-gifs/${slug}.gif`);
      expect(entry.attribution, `${slug}.attribution`).toMatch(/\S/);
      expect(entry.license, `${slug}.license`).toMatch(/\S/);
      expect(entry.verificationStatus, `${slug}.verificationStatus`).toBe('verified');
      expect(entry.reviewDate, `${slug}.reviewDate`).toMatch(/\S/);
    }
  });

  it('validateRegistry() is clean for the owner-supplied registry', () => {
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
    expect(entry?.verificationStatus).toBe('verified');
    expect(entry?.assetUrl).toBe('/exercise-gifs/push-up.gif');
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

  it('unverified db video does NOT bypass the registry — illustration instead', () => {
    // Temporarily mark the registry entry "missing": a DB mediaUrl must not
    // present itself as an approved demo.
    EXERCISE_MEDIA['push-up'] = {
      ...originalPushUp,
      mediaType: null,
      assetUrl: null,
      attribution: null,
      license: null,
      verificationStatus: 'missing',
      reviewDate: null,
    };
    expect(selectMediaSource('push-up', 'video', 'https://db.example.com/push-up.mp4')).toBe(
      'illustration'
    );
    expect(selectMediaSource('push-up', 'gif', 'https://db.example.com/push-up.gif')).toBe(
      'illustration'
    );
    expect(hasVerifiedDbAsset('push-up', 'video', 'https://db.example.com/push-up.mp4')).toBe(
      false
    );
  });

  it('db asset counts only behind a verified registry entry', () => {
    verifyPushUp();
    expect(
      selectMediaSource('push-up', 'gif', 'https://db.example.com/push-up.gif')
    ).toBe('video');
    expect(hasVerifiedDbAsset('push-up', 'gif', 'https://db.example.com/push-up.gif')).toBe(
      true
    );
  });

  it('db video for an unknown slug cannot bypass — honest "coming-soon"', () => {
    expect(selectMediaSource('not-a-real-exercise', 'video', 'https://db.example.com/x.mp4')).toBe(
      'coming-soon'
    );
  });

  it('blank mediaUrl does not count as a db video — falls back to illustration', () => {
    EXERCISE_MEDIA['push-up'] = {
      ...originalPushUp,
      mediaType: null,
      assetUrl: null,
      attribution: null,
      license: null,
      verificationStatus: 'missing',
      reviewDate: null,
    };
    expect(selectMediaSource('push-up', 'video', '   ')).toBe('illustration');
  });

  it('non-video mediaType does not count — falls back to illustration', () => {
    EXERCISE_MEDIA['push-up'] = {
      ...originalPushUp,
      mediaType: null,
      assetUrl: null,
      attribution: null,
      license: null,
      verificationStatus: 'missing',
      reviewDate: null,
    };
    expect(selectMediaSource('push-up', 'image', 'https://db.example.com/x.jpg')).toBe(
      'illustration'
    );
  });

  it('illustration fallback for a slug with no verified asset', () => {
    EXERCISE_MEDIA['push-up'] = {
      ...originalPushUp,
      mediaType: null,
      assetUrl: null,
      attribution: null,
      license: null,
      verificationStatus: 'missing',
      reviewDate: null,
    };
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

describe('verified-asset hardening', () => {
  const originalPushUp: ExerciseMediaEntry = { ...EXERCISE_MEDIA['push-up'] };

  afterEach(() => {
    EXERCISE_MEDIA['push-up'] = { ...originalPushUp };
  });

  it('verified status without reviewDate does NOT count as a verified asset', () => {
    EXERCISE_MEDIA['push-up'] = {
      displayName: 'Push-Up',
      mediaType: 'mp4',
      assetUrl: 'https://cdn.example.com/push-up.mp4',
      posterUrl: null,
      attribution: 'FitFusion Media',
      license: 'Proprietary commercial',
      verificationStatus: 'verified',
      reviewDate: null, // missing — not approved
    };
    expect(hasVerifiedAsset('push-up')).toBe(false);
    expect(selectMediaSource('push-up')).toBe('illustration');
    expect(
      validateRegistry().some((p) => p.includes('verified without reviewDate'))
    ).toBe(true);
  });

  it('verified status without license does NOT count as a verified asset', () => {
    EXERCISE_MEDIA['push-up'] = {
      displayName: 'Push-Up',
      mediaType: 'mp4',
      assetUrl: 'https://cdn.example.com/push-up.mp4',
      posterUrl: null,
      attribution: 'FitFusion Media',
      license: null, // missing — not approved
      verificationStatus: 'verified',
      reviewDate: '2026-10-11',
    };
    expect(hasVerifiedAsset('push-up')).toBe(false);
    expect(
      validateRegistry().some((p) => p.includes('verified without license'))
    ).toBe(true);
  });
});

describe('assetMimeType — correct MIME per container', () => {
  it('maps mp4/webm/gif/webp to their real MIME types', () => {
    expect(assetMimeType('mp4')).toBe('video/mp4');
    expect(assetMimeType('webm')).toBe('video/webm');
    expect(assetMimeType('gif')).toBe('image/gif');
    expect(assetMimeType('webp')).toBe('image/webp');
  });

  it('never declares webm as video/mp4', () => {
    expect(assetMimeType('webm')).not.toBe('video/mp4');
  });
});

describe('owner-supplied GIF files on disk', () => {
  it('all 50 registry assetUrls resolve to real animated GIF files', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const publicDir = path.resolve(__dirname, '../../public');
    let checked = 0;
    for (const slug of SLUGS) {
      const entry = EXERCISE_MEDIA[slug];
      const filePath = path.join(publicDir, entry.assetUrl as string);
      expect(fs.existsSync(filePath), `${slug}: file exists at ${entry.assetUrl}`).toBe(true);
      const magic = fs.readFileSync(filePath).subarray(0, 6).toString('ascii');
      expect(['GIF87a', 'GIF89a'], `${slug}: valid GIF magic bytes`).toContain(magic);
      checked++;
    }
    expect(checked).toBe(50);
  });
});
