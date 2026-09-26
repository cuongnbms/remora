/** Past this many matches the search stops; highlighting more would stall the view. */
export const MAX_MATCHES = 10_000;

export type Offsets = { start: number; end: number };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Non-overlapping literal matches of `query` in `text`, in order. */
export function findOffsets(text: string, query: string, matchCase: boolean): Offsets[] {
  if (!query) return [];
  // The `i` flag without `u` folds case one UTF-16 unit at a time, so match offsets line up
  // with `text` (lowercasing the whole string first would not: 'İ' grows to two units).
  const re = new RegExp(escapeRe(query), matchCase ? 'g' : 'gi');
  const out: Offsets[] = [];
  for (let m = re.exec(text); m && out.length < MAX_MATCHES; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * DOM ranges for every match of `query` in the visible text under `root`. Text is joined across
 * nodes first, so a match may span elements (highlighted code has one span per token).
 * Text inside SVG (mermaid diagrams) is skipped.
 */
export function findRanges(root: Element, query: string, matchCase: boolean): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push(n);
    starts.push(text.length);
    text += n.data;
  }

  // Index of the node holding character `pos` (the last node starting at or before it).
  const nodeAt = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return findOffsets(text, query, matchCase).map(({ start, end }) => {
    const a = nodeAt(start);
    const b = nodeAt(end - 1);
    const range = document.createRange();
    range.setStart(nodes[a], start - starts[a]);
    range.setEnd(nodes[b], end - starts[b]);
    return range;
  });
}

/** Scrolls every scroller from the match up to `root` so the match sits mid-view, if it is out of view. */
export function reveal(range: Range, root: Element): void {
  for (let el = range.startContainer.parentElement; el; el = el.parentElement) {
    const r = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (el.scrollHeight > el.clientHeight && (r.top < box.top || r.bottom > box.bottom))
      el.scrollTop += r.top - box.top - (box.height - r.height) / 2;
    if (el.scrollWidth > el.clientWidth && (r.left < box.left || r.right > box.right))
      el.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
    if (el === root) break;
  }
}
