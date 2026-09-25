import { expect, test } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

const files = [
  'apps/search/charts.ts',
  'docs/architecture-current.md',
  'docs/architecture-mermaid.md',
  'README.md',
];

test('non-subsequence does not match', () => {
  expect(fuzzyScore('xyz', 'README.md')).toBeNull();
});

test('basename prefix ranks above scattered matches', () => {
  expect(fuzzyFilter('arch', files)[0]).toBe('docs/architecture-current.md');
  expect(fuzzyFilter('archmer', files)[0]).toBe('docs/architecture-mermaid.md');
});

test('case-insensitive', () => {
  expect(fuzzyFilter('readme', files)).toEqual(['README.md']);
});

test('empty query returns the first items up to limit', () => {
  expect(fuzzyFilter('', files, 2)).toEqual(files.slice(0, 2));
});
