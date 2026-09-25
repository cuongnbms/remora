import { expect, test } from 'vitest';
import { dirsToRefresh } from './tree';

test('dirsToRefresh includes parents and changed dirs', () => {
  expect(
    dirsToRefresh([
      { path: 'docs/a.md', isDir: false, removed: false },
      { path: 'docs', isDir: true, removed: false },
      { path: 'x.md', isDir: false, removed: true },
    ]).sort(),
  ).toEqual(['', 'docs']);
});

test('root dir change refreshes root', () => {
  expect(dirsToRefresh([{ path: '', isDir: true, removed: false }])).toEqual(['']);
});
