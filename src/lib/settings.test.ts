import { beforeEach, describe, expect, test } from 'vitest';
import { applySettings, DEFAULT_SETTINGS, fontStack, isDark, parseExcludes, readCachedSettings, cacheSettings } from './settings';

describe('fontStack', () => {
  test('quotes the family and keeps the fallback', () => {
    expect(fontStack('JetBrains Mono', 'monospace')).toBe('"JetBrains Mono", monospace');
  });
  test('escapes quotes and backslashes', () => {
    expect(fontStack('A "B" \\C', 'serif')).toBe('"A \\"B\\" \\\\C", serif');
  });
});

describe('isDark', () => {
  test('follows the system only in system mode', () => {
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
    expect(isDark('light', true)).toBe(false);
    expect(isDark('dark', false)).toBe(true);
  });
});

describe('applySettings', () => {
  const root = document.documentElement;
  beforeEach(() => {
    root.removeAttribute('data-theme');
    root.removeAttribute('style');
  });

  test('sets theme attribute and css variables', () => {
    applySettings({ theme: 'dark', uiFont: 'Inter', codeFont: 'Fira Code', fontSize: 15, excludes: [] }, root);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--font-size')).toBe('15px');
    expect(root.style.getPropertyValue('--font-ui')).toContain('"Inter"');
    expect(root.style.getPropertyValue('--font-code')).toContain('"Fira Code"');
  });

  test('defaults clear font overrides so the stylesheet stack applies', () => {
    applySettings({ theme: 'dark', uiFont: 'Inter', codeFont: 'Fira Code', fontSize: 15, excludes: [] }, root);
    applySettings(DEFAULT_SETTINGS, root);
    expect(root.dataset.theme).toBe('system');
    expect(root.style.getPropertyValue('--font-ui')).toBe('');
    expect(root.style.getPropertyValue('--font-code')).toBe('');
    expect(root.style.getPropertyValue('--font-size')).toBe('13px');
  });
});

describe('settings cache', () => {
  beforeEach(() => localStorage.clear());

  test('roundtrips', () => {
    const s = { theme: 'light', uiFont: null, codeFont: 'Menlo', fontSize: 14, excludes: ['out'] } as const;
    cacheSettings({ ...s, excludes: [...s.excludes] });
    expect(readCachedSettings()).toEqual(s);
  });

  test('fills excludes for a cache written before they existed', () => {
    localStorage.setItem('remora.settings', JSON.stringify({ theme: 'dark', uiFont: null, codeFont: null, fontSize: 13 }));
    expect(readCachedSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
  });

  test('falls back to defaults for missing or malformed data', () => {
    expect(readCachedSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('remora.settings', '{oops');
    expect(readCachedSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('remora.settings', JSON.stringify({ theme: 'blue', fontSize: 'x' }));
    expect(readCachedSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('parseExcludes', () => {
  test('one name per line, trimmed, blanks and repeats dropped', () => {
    expect(parseExcludes('  node_modules \n\nvenv\r\nvenv\n.git')).toEqual(['node_modules', 'venv', '.git']);
    expect(parseExcludes(' \n')).toEqual([]);
  });
});
