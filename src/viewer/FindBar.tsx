import { useEffect, useRef, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from '../filepanel/icons';
import { findRanges, MAX_MATCHES, reveal } from '../lib/find';
import { useStore } from '../store';

type Props = {
  /** The scroll container whose text is searched. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** Changes when the container is swapped for another element (rendered ↔ source). */
  rootKey: string;
  onClose: () => void;
};

// Match highlights go through the CSS Custom Highlight API: the DOM belongs to React,
// shiki and mermaid, so marking matches must not add elements to it.
const hasHighlights = () => typeof CSS !== 'undefined' && 'highlights' in CSS;

// WebKit does not fully repaint text whose highlight changed, leaving stale marks behind
// (replacing the Highlight object is worse than clear() + add(), but both leave fragments).
// Nudging the content's opacity for one frame forces a repaint of the whole block.
function repaint(root: Element | null) {
  const el = root?.firstElementChild;
  if (!(el instanceof HTMLElement) || typeof requestAnimationFrame === 'undefined') return;
  el.style.opacity = '0.999';
  requestAnimationFrame(() => {
    el.style.opacity = '';
  });
}

function setHighlight(name: string, ranges: Range[]) {
  if (!hasHighlights()) return;
  let hl = CSS.highlights.get(name);
  if (!hl) {
    hl = new Highlight();
    CSS.highlights.set(name, hl);
  }
  hl.clear();
  for (const r of ranges) hl.add(r);
}

function clearHighlights() {
  if (!hasHighlights()) return;
  for (const name of ['find-match', 'find-current']) {
    CSS.highlights.get(name)?.clear();
    CSS.highlights.delete(name);
  }
}

/** The first match at or below the top of the visible area, so a new search starts where you are reading. */
function firstVisible(ranges: Range[], root: Element | null): number {
  if (!root) return 0;
  const top = root.getBoundingClientRect().top;
  // Matches are in document order, so their tops only grow: binary search keeps this to a
  // handful of layout queries even with thousands of matches.
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid].getBoundingClientRect().top >= top) hi = mid;
    else lo = mid + 1;
  }
  return lo < ranges.length ? lo : 0;
}

export function FindBar({ rootRef, rootKey, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  // Bumped when the searched DOM changes (reload, async highlighting, mermaid).
  const [contentSeq, setContentSeq] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useStore((s) => s.findRequest);

  const search = () => {
    const root = rootRef.current;
    return root ? findRanges(root, query, matchCase) : [];
  };

  const step = (dir: 1 | -1) => {
    if (!ranges.length) return;
    const i = (index + dir + ranges.length) % ranges.length;
    setIndex(i);
    if (rootRef.current) reveal(ranges[i], rootRef.current);
  };

  useEffect(() => {
    if (!request) return;
    if (request.action === 'open') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else step(request.action === 'next' ? 1 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setContentSeq((n) => n + 1), 50);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    setContentSeq((n) => n + 1);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [rootRef, rootKey]);

  // A new query jumps to the nearest match; a content change keeps the position without scrolling.
  useEffect(() => {
    const next = search();
    const i = firstVisible(next, rootRef.current);
    setRanges(next);
    setIndex(i);
    if (next.length && rootRef.current) reveal(next[i], rootRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase]);

  useEffect(() => {
    if (!contentSeq) return;
    const next = search();
    setRanges(next);
    setIndex((i) => Math.max(0, Math.min(i, next.length - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSeq]);

  useEffect(() => {
    setHighlight('find-match', ranges);
    setHighlight('find-current', ranges.length ? [ranges[index]] : []);
    repaint(rootRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranges, index]);

  useEffect(
    () => () => {
      clearHighlights();
      repaint(rootRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };

  const count = !query ? '' : ranges.length ? `${index + 1}/${ranges.length}${ranges.length >= MAX_MATCHES ? '+' : ''}` : 'No results';

  return (
    <div className="find-bar" role="search" onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        value={query}
        placeholder="Find"
        aria-label="Find in file"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className="find-count">{count}</span>
      <button
        className={'icon-btn find-case' + (matchCase ? ' on' : '')}
        title="Match case"
        aria-label="Match case"
        aria-pressed={matchCase}
        onClick={() => setMatchCase((v) => !v)}
      >
        Aa
      </button>
      <button className="icon-btn" title="Previous match (⇧⌘G)" aria-label="Previous match" onClick={() => step(-1)}>
        <ArrowUpIcon />
      </button>
      <button className="icon-btn" title="Next match (⌘G)" aria-label="Next match" onClick={() => step(1)}>
        <ArrowDownIcon />
      </button>
      <button className="icon-btn" title="Close (Esc)" aria-label="Close find" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}
