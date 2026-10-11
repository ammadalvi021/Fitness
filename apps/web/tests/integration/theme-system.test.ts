/**
 * Theme system contract tests (PHASE 2 luxury design system).
 *
 * Pure-logic tests for the theme resolution helpers exported from
 * components/ThemeProvider. No DOM needed: resolveTheme(stored, prefersDark)
 * is a total function over (stored value, device color scheme).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_LABELS,
  isDarkTheme,
  parseStoredTheme,
  resolveTheme,
} from '@/components/ThemeProvider';

describe('parseStoredTheme', () => {
  it('accepts every valid theme value unchanged', () => {
    for (const t of THEMES) {
      expect(parseStoredTheme(t)).toBe(t);
    }
  });

  it('falls back to obsidian-gold for missing values', () => {
    expect(parseStoredTheme(null)).toBe('obsidian-gold');
    expect(parseStoredTheme(undefined)).toBe('obsidian-gold');
    expect(parseStoredTheme('')).toBe('obsidian-gold');
  });

  it('falls back to obsidian-gold for invalid values', () => {
    expect(parseStoredTheme('dark')).toBe('obsidian-gold');
    expect(parseStoredTheme('light')).toBe('obsidian-gold');
    expect(parseStoredTheme('OBSIDIAN-GOLD')).toBe('obsidian-gold');
    expect(parseStoredTheme('midnight emerald')).toBe('obsidian-gold');
  });
});

describe('resolveTheme', () => {
  it('returns each concrete theme unchanged regardless of device scheme', () => {
    const concrete = ['obsidian-gold', 'midnight-emerald', 'slate-silver', 'light-luxe'] as const;
    for (const t of concrete) {
      expect(resolveTheme(t, true)).toBe(t);
      expect(resolveTheme(t, false)).toBe(t);
    }
  });

  it('resolves system to obsidian-gold when the device is dark', () => {
    expect(resolveTheme('system', true)).toBe('obsidian-gold');
  });

  it('resolves system to light-luxe when the device is light', () => {
    expect(resolveTheme('system', false)).toBe('light-luxe');
  });

  it('falls back to the default (obsidian-gold) for unknown/missing values', () => {
    expect(resolveTheme(null, true)).toBe('obsidian-gold');
    expect(resolveTheme(undefined, false)).toBe('obsidian-gold');
    expect(resolveTheme('dark', true)).toBe('obsidian-gold');
    expect(resolveTheme('light', false)).toBe('obsidian-gold');
    expect(resolveTheme('nope', true)).toBe('obsidian-gold');
  });

  it('never returns "system" (always a concrete renderable theme)', () => {
    const storedValues: Array<string | null | undefined> = [
      'system',
      'obsidian-gold',
      'midnight-emerald',
      'slate-silver',
      'light-luxe',
      null,
      undefined,
      'bogus',
    ];
    for (const s of storedValues) {
      for (const prefersDark of [true, false]) {
        expect(resolveTheme(s, prefersDark)).not.toBe('system');
      }
    }
  });
});

describe('isDarkTheme', () => {
  it('marks the three dark themes as dark', () => {
    expect(isDarkTheme('obsidian-gold')).toBe(true);
    expect(isDarkTheme('midnight-emerald')).toBe(true);
    expect(isDarkTheme('slate-silver')).toBe(true);
  });

  it('marks light-luxe as not dark', () => {
    expect(isDarkTheme('light-luxe')).toBe(false);
  });
});

describe('theme registry', () => {
  it('exposes exactly the five selectable themes', () => {
    expect([...THEMES]).toEqual([
      'obsidian-gold',
      'midnight-emerald',
      'slate-silver',
      'light-luxe',
      'system',
    ]);
  });

  it('has a friendly label for every theme', () => {
    for (const t of THEMES) {
      expect(THEME_LABELS[t]).toBeTruthy();
    }
    expect(THEME_LABELS['obsidian-gold']).toBe('Obsidian Gold');
  });

  it('defaults to obsidian-gold', () => {
    expect(DEFAULT_THEME).toBe('obsidian-gold');
  });
});
