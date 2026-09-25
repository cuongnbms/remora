import { useEffect, useMemo, useState } from 'react';
import { fuzzyFilter } from '../lib/fuzzy';
import { basename, dirname } from '../lib/paths';
import { useStore } from '../store';

export function QuickOpen() {
  const open = useStore((s) => s.quickOpen);
  const projectId = useStore((s) => s.activeProjectId);
  const files = useStore((s) => (s.activeProjectId ? (s.views[s.activeProjectId]?.files ?? null) : null));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => (files ? fuzzyFilter(query, files, 50) : []), [query, files]);

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
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
