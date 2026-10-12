/**
 * Theme system contract tests (PHASE 2 luxury design system).
 *
 * Pure-logic tests for the theme resolution helpers exported from
 * components/ThemeProvider. No DOM needed: resolveTheme(stored, prefersDark)
 * is a total function over (stored value, device color scheme).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DARK_THEMES,
  DEFAULT_THEME,
  THEMES,
  THEME_LABELS,
  THEME_INIT_SCRIPT,
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
    const concrete = [
      'obsidian-gold',
      'obsidian-gold-light',
      'midnight-emerald',
      'midnight-emerald-light',
      'slate-silver',
      'slate-silver-light',
      'light-luxe',
    ] as const;
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

  it('marks the light themes as not dark', () => {
    expect(isDarkTheme('obsidian-gold-light')).toBe(false);
    expect(isDarkTheme('midnight-emerald-light')).toBe(false);
    expect(isDarkTheme('slate-silver-light')).toBe(false);
    expect(isDarkTheme('light-luxe')).toBe(false);
  });

  it('DARK_THEMES matches isDarkTheme for every concrete theme', () => {
    for (const t of THEMES) {
      if (t === 'system') continue;
      expect(DARK_THEMES.has(t)).toBe(isDarkTheme(t));
    }
  });
});

describe('theme registry', () => {
  it('exposes exactly the eight selectable themes', () => {
    expect([...THEMES]).toEqual([
      'obsidian-gold',
      'obsidian-gold-light',
      'midnight-emerald',
      'midnight-emerald-light',
      'slate-silver',
      'slate-silver-light',
      'light-luxe',
      'system',
    ]);
  });

  it('has a friendly label for every theme', () => {
    for (const t of THEMES) {
      expect(THEME_LABELS[t]).toBeTruthy();
    }
    expect(THEME_LABELS['obsidian-gold']).toBe('Obsidian Gold');
    expect(THEME_LABELS['obsidian-gold-light']).toBe('Obsidian Gold — Light');
  });

  it('defaults to obsidian-gold', () => {
    expect(DEFAULT_THEME).toBe('obsidian-gold');
  });
});

describe('THEME_INIT_SCRIPT', () => {
  it('accepts every selectable theme value (no-flash parity with the provider)', () => {
    for (const t of THEMES) {
      expect(THEME_INIT_SCRIPT).toContain(`'${t}'`);
    }
  });

  it('maps the dark class only to the three dark themes', () => {
    // The script's dark-check list must mirror DARK_THEMES exactly.
    for (const t of DARK_THEMES) {
      expect(THEME_INIT_SCRIPT).toContain(t);
    }
    const darkCheck = THEME_INIT_SCRIPT.match(/dk=\[([^\]]*)\]/);
    expect(darkCheck, 'init script has an explicit dark-theme list').toBeTruthy();
    const listed = darkCheck![1];
    for (const t of DARK_THEMES) {
      expect(listed).toContain(`'${t}'`);
    }
    for (const light of [
      'obsidian-gold-light',
      'midnight-emerald-light',
      'slate-silver-light',
      'light-luxe',
    ]) {
      expect(listed).not.toContain(`'${light}'`);
    }
  });

  it('keeps system resolution behavior (dark→obsidian-gold, light→light-luxe)', () => {
    expect(THEME_INIT_SCRIPT).toContain('obsidian-gold');
    expect(THEME_INIT_SCRIPT).toContain('light-luxe');
    expect(THEME_INIT_SCRIPT).toMatch(/prefers-color-scheme/);
  });
});

describe('globals.css token coverage', () => {
  const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

  it('every concrete theme has a token set (obsidian-gold is the :root default)', () => {
    // obsidian-gold tokens live in :root; every other concrete theme needs
    // its own html[data-theme="…"] block.
    expect(css).toContain('--bg: #090b0f'); // :root default = obsidian-gold
    for (const t of THEMES) {
      if (t === 'system' || t === 'obsidian-gold') continue;
      expect(css, `token block for ${t}`).toContain(`html[data-theme="${t}"]`);
    }
  });

  it('each theme block defines the core token set', () => {
    const coreTokens = [
      '--bg:',
      '--bg-elevated:',
      '--bg-secondary:',
      '--accent:',
      '--text:',
      '--text-secondary:',
      '--on-accent:',
      '--border:',
    ];
    for (const t of THEMES) {
      if (t === 'system') continue;
      const block =
        t === 'obsidian-gold'
          ? css.slice(0, css.indexOf('html[data-theme='))
          : css.slice(css.indexOf(`html[data-theme="${t}"]`));
      for (const token of coreTokens) {
        expect(block, `${t} defines ${token}`).toContain(token);
      }
    }
  });
});
