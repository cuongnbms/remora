// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { findOffsets, findRanges, MAX_MATCHES } from './find';

describe('findOffsets', () => {
  test('ignores case by default', () => {
    expect(findOffsets('Foo foo FOO', 'foo', false)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  test('match case keeps only exact matches', () => {
    expect(findOffsets('Foo foo FOO', 'foo', true)).toEqual([{ start: 4, end: 7 }]);
  });

  test('an empty query finds nothing', () => {
    expect(findOffsets('abc', '', false)).toEqual([]);
  });

  test('treats the query literally, not as a regex', () => {
    expect(findOffsets('a.b axb (x)', 'a.b', false)).toEqual([{ start: 0, end: 3 }]);
    expect(findOffsets('a.b axb (x)', '(x)', false)).toEqual([{ start: 8, end: 11 }]);
  });

  test('matches do not overlap', () => {
    expect(findOffsets('aaaa', 'aa', false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  test('stops at the match limit', () => {
    expect(findOffsets('a'.repeat(MAX_MATCHES + 5), 'a', false)).toHaveLength(MAX_MATCHES);
  });
});

describe('findRanges', () => {
  const dom = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  };

  test('a match can span several text nodes', () => {
    // Shiki puts each token in its own span, so `foo.bar` is split across three nodes.
    const root = dom('<span>foo</span><span>.</span><span>bar</span> x');
    const ranges = findRanges(root, 'o.b', false);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('o.b');
    expect(ranges[0].startContainer.textContent).toBe('foo');
    expect(ranges[0].endContainer.textContent).toBe('bar');
  });

  test('finds every match in document order', () => {
    const root = dom('<p>one Two</p><p>two <b>tWo</b></p>');
    expect(findRanges(root, 'two', false).map((r) => r.toString())).toEqual(['Two', 'two', 'tWo']);
    expect(findRanges(root, 'two', true).map((r) => r.toString())).toEqual(['two']);
  });

  test('skips text inside svg diagrams', () => {
    const root = dom('<p>node</p><svg><text>node</text></svg>');
    expect(findRanges(root, 'node', false)).toHaveLength(1);
  });

  test('an empty root finds nothing', () => {
    expect(findRanges(dom(''), 'x', false)).toEqual([]);
  });
});
