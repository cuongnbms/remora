import { useEffect, useRef, useState } from 'react';
import { ChevronIcon } from '../filepanel/icons';
import type { TocItem } from '../lib/markdown';

const WIDTH_KEY = 'remora.tocWidth';
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const LEVELS = [1, 2, 3];

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

function readWidth(): number {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w ? clampWidth(w) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(w: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(w));
  } catch {
    /* storage unavailable: width is best-effort */
  }
}

/** Width of the TOC column in px, adjusted by dragging its right edge and remembered across files. */
function useTocWidth() {
  const [width, setWidth] = useState(readWidth);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width, width };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      drag.current.width = clampWidth(drag.current.startWidth + ev.clientX - drag.current.startX);
      setWidth(drag.current.width);
    };
    const up = () => {
      if (drag.current) saveWidth(drag.current.width);
      cleanup.current?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add('resizing-col');
    cleanup.current = () => {
      drag.current = null;
      cleanup.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-col');
    };
  };

  const reset = () => {
    setWidth(DEFAULT_WIDTH);
    saveWidth(DEFAULT_WIDTH);
  };

  return { width, onPointerDown, reset };
}

export function Toc({ items, activeId, onSelect }: { items: TocItem[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const { width, onPointerDown, reset } = useTocWidth();
  const minLevel = Math.min(...items.map((i) => i.level));
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // A heading's parent is the nearest earlier heading of a shallower level; it is hidden when any ancestor is collapsed.
  const ancestors: { level: number; collapsed: boolean }[] = [];
  const rows = items.map((item, i) => {
    const key = `${item.id}-${i}`;
    while (ancestors.length && ancestors[ancestors.length - 1].level >= item.level) ancestors.pop();
    const hidden = ancestors.some((a) => a.collapsed);
    const isCollapsed = collapsed.has(key);
    ancestors.push({ level: item.level, collapsed: isCollapsed });
    const hasChildren = (items[i + 1]?.level ?? 0) > item.level;
    return { item, key, hidden, isCollapsed, hasChildren };
  });

  // Shows headings down to `level`: every heading at that level or deeper folds its subtree, shallower ones unfold.
  const collapseTo = (level: number) =>
    setCollapsed(new Set(rows.filter((r) => r.hasChildren && r.item.level >= level).map((r) => r.key)));

  return (
    <>
      <nav className="toc" style={{ width }}>
        <div className="toc-header">
          <span className="toc-title">Contents</span>
          <span className="toc-levels">
            {LEVELS.map((n) => (
              <button key={n} title={`Show up to H${n}`} aria-label={`Show up to H${n}`} onClick={() => collapseTo(n)}>
                H{n}
              </button>
            ))}
          </span>
        </div>
        <ul>
          {rows
            .filter((r) => !r.hidden)
            .map(({ item, key, isCollapsed, hasChildren }) => (
              <li
                key={key}
                className={item.id === activeId ? 'active' : ''}
                style={{ paddingLeft: 4 + (item.level - minLevel) * 14 }}
                title={item.text}
                onClick={() => onSelect(item.id)}
              >
                {hasChildren ? (
                  <span
                    className={'toc-toggle' + (isCollapsed ? '' : ' open')}
                    role="button"
                    aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(key);
                    }}
                  >
                    <ChevronIcon />
                  </span>
                ) : (
                  <span className="toc-toggle" />
                )}
                <span className="toc-text">{item.text}</span>
              </li>
            ))}
        </ul>
      </nav>
      <div className="toc-resize" title="Drag to resize, double-click to reset" onPointerDown={onPointerDown} onDoubleClick={reset} />
    </>
  );
}
