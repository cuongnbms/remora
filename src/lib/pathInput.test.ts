import { describe, expect, test } from 'vitest';
import { contractHome, dirSuggestions, expandHome, splitDirPrefix } from './pathInput';
import type { Entry } from './types';

const dir = (name: string): Entry => ({ name, kind: 'dir', symlink: false, size: 0, mtime: 0 });
const file = (name: string): Entry => ({ name, kind: 'file', symlink: false, size: 0, mtime: 0 });

describe('pathInput', () => {
  test('expandHome replaces a leading ~ only', () => {
    expect(expandHome('~', '/Users/me')).toBe('/Users/me');
    expect(expandHome('~/', '/Users/me')).toBe('/Users/me/');
    expect(expandHome('~/code', '/Users/me')).toBe('/Users/me/code');
    expect(expandHome('/a/~/b', '/Users/me')).toBe('/a/~/b');
    expect(expandHome('~other', '/Users/me')).toBe('~other');
    expect(expandHome('~/x', null)).toBe('~/x');
  });

  test('contractHome writes paths under home with ~', () => {
    expect(contractHome('/Users/me', '/Users/me')).toBe('~');
    expect(contractHome('/Users/me/code', '/Users/me/')).toBe('~/code');
    expect(contractHome('/Users/meow', '/Users/me')).toBe('/Users/meow');
    expect(contractHome('/srv/x', null)).toBe('/srv/x');
    expect(contractHome('/x', '/')).toBe('/x');
  });

  test('splitDirPrefix splits at the last slash', () => {
    expect(splitDirPrefix('/Users/me/co')).toEqual({ dir: '/Users/me', prefix: 'co' });
    expect(splitDirPrefix('/Users/me/')).toEqual({ dir: '/Users/me', prefix: '' });
    expect(splitDirPrefix('/us')).toEqual({ dir: '/', prefix: 'us' });
    expect(splitDirPrefix('/')).toEqual({ dir: '/', prefix: '' });
    expect(splitDirPrefix('relative')).toBeNull();
  });

  test('dirSuggestions keeps matching folders, hides dotfolders unless typed', () => {
    const entries = [dir('code'), dir('Config'), file('code.txt'), dir('.cache'), dir('docs')];
    expect(dirSuggestions(entries, '/home/me', 'co')).toEqual(['/home/me/code', '/home/me/Config']);
    expect(dirSuggestions(entries, '/home/me', '')).toEqual(['/home/me/code', '/home/me/Config', '/home/me/docs']);
    expect(dirSuggestions(entries, '/home/me', '.')).toEqual(['/home/me/.cache']);
    expect(dirSuggestions(entries, '/', 'd')).toEqual(['/docs']);
  });
});
