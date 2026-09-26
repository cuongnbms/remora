import { useEffect, useMemo, useState } from 'react';
import { fuzzyFilter } from '../lib/fuzzy';
import { basename, dirname } from '../lib/paths';
import { EMPTY_LIST, useStore } from '../store';

/** Files viewed most recently first (history, then open tabs), limited to those that still exist. */
export function recentFiles(history: string[], tabs: string[], files: string[] | null): string[] {
  const existing = files ? new Set(files) : null;
  const seen = new Set<string>();
  for (const p of [...history].reverse().concat(tabs)) if (!existing || existing.has(p)) seen.add(p);
  return [...seen];
}

export function QuickOpen() {
  const open = useStore((s) => s.quickOpen);
  const projectId = useStore((s) => s.activeProjectId);
  const files = useStore((s) => (s.activeProjectId ? (s.views[s.activeProjectId]?.files ?? null) : null));
  const history = useStore((s) => (s.activeProjectId ? s.views[s.activeProjectId]?.history : undefined) ?? EMPTY_LIST);
  const tabs = useStore((s) => (s.activeProjectId ? s.views[s.activeProjectId]?.tabs : undefined) ?? EMPTY_LIST);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  // Like VS Code: with nothing typed, recently opened files come first.
  const recent = useMemo(() => (query ? [] : recentFiles(history, tabs, files)), [query, history, tabs, files]);
  const results = useMemo(() => {
    if (!files) return [];
    if (query) return fuzzyFilter(query, files, 50);
    const isRecent = new Set(recent);
    return recent.concat(files.filter((p) => !isRecent.has(p))).slice(0, 50);
  }, [query, files, recent]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  if (!open || !projectId) return null;
  const close = () => useStore.getState().setQuickOpen(false);
  const choose = (p: string) => {
    useStore.getState().openFile(p);
    close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="quickopen" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Go to file…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && results[selected]) choose(results[selected]);
            else if (e.key === 'Escape') close();
          }}
        />
        <ul>
          {files === null ? (
            <li className="muted">Loading file list…</li>
          ) : (
            results.map((p, i) => (
              <li key={p} className={i === selected ? 'selected' : ''} onMouseEnter={() => setSelected(i)} onClick={() => choose(p)}>
                <span>{basename(p)}</span> <span className="muted small">{dirname(p)}</span>
                {i < recent.length && <span className="muted small recent-tag">recently opened</span>}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
