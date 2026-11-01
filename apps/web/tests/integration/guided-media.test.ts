/**
 * Guided-media manifest — honesty contracts (V22 Phase A).
 *
 * The GUIDED_MEDIA manifest covers the Yoga & Aerobics catalog. This suite
 * enforces that:
 * - it covers EXACTLY the seeded pose + routine slug sets (sourced from the
 *   seed data file itself, so the two can never drift apart silently);
 * - every non-null videoUrl/posterUrl resolves to a real file on disk in
 *   apps/web/public (no invented assets);
 * - no entry points at the strength library (/exercise-videos/) — an
 *   unrelated clip is never substituted for a pose or routine;
 * - placeholder entries carry null URLs (the UI renders a labelled
 *   placeholder, never a fake video).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDED_MEDIA } from '@/lib/guided-media/manifest';
import {
  AEROBIC_ROUTINES,
  YOGA_POSES,
} from '../../../../packages/db/prisma/seed-guided-data';

const EXPECTED_POSE_SLUGS = YOGA_POSES.map((p) => p.slug).sort();
const EXPECTED_ROUTINE_SLUGS = AEROBIC_ROUTINES.map((r) => r.slug).sort();

describe('GUIDED_MEDIA manifest — guided catalog contract', () => {
  it('covers exactly the seeded slug sets (25 poses + 6 routines)', () => {
    expect(EXPECTED_POSE_SLUGS).toHaveLength(25);
    expect(EXPECTED_ROUTINE_SLUGS).toHaveLength(6);
    expect(Object.keys(GUIDED_MEDIA).sort()).toEqual(
      [...EXPECTED_POSE_SLUGS, ...EXPECTED_ROUTINE_SLUGS].sort(),
    );
  });

  it('kinds match the catalog each slug belongs to', () => {
    for (const slug of EXPECTED_POSE_SLUGS) {
      expect(GUIDED_MEDIA[slug].kind, slug).toBe('yoga-pose');
    }
    for (const slug of EXPECTED_ROUTINE_SLUGS) {
      expect(GUIDED_MEDIA[slug].kind, slug).toBe('aerobics-routine');
    }
  });

  it('every referenced asset resolves to a real file; placeholders have null URLs', () => {
    const publicDir = path.resolve(__dirname, '../../public');
    for (const [slug, entry] of Object.entries(GUIDED_MEDIA)) {
      if (entry.mediaStatus === 'placeholder') {
        expect(entry.videoUrl, `${slug}.videoUrl`).toBeNull();
        expect(entry.posterUrl, `${slug}.posterUrl`).toBeNull();
      }
      for (const url of [entry.videoUrl, entry.posterUrl]) {
        if (url === null) continue;
        expect(entry.mediaStatus, `${slug} has a URL but is not verified`).toBe('verified');
        expect(url.startsWith('/'), `${slug} url must be site-relative`).toBe(true);
        expect(
          existsSync(path.join(publicDir, url)),
          `${slug} -> ${url} must exist in apps/web/public`,
        ).toBe(true);
      }
    }
  });

  it('no entry references the strength exercise library', () => {
    for (const [slug, entry] of Object.entries(GUIDED_MEDIA)) {
      for (const url of [entry.videoUrl, entry.posterUrl]) {
        if (url === null) continue;
        expect(url.includes('/exercise-videos/'), `${slug} -> ${url}`).toBe(false);
        expect(url.includes('/exercise-gifs/'), `${slug} -> ${url}`).toBe(false);
      }
    }
  });
});
