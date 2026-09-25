import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { basename } from '../lib/paths';
import { contractHome, dirSuggestions, expandHome, splitDirPrefix } from '../lib/pathInput';
import type { Entry } from '../lib/types';

type Props = {
  host: string;
  /** Home folder on `host`, used to expand `~`; null until it is known. */
  home: string | null;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * Path field with a folder dropdown: ↑/↓ highlight, Tab or Enter completes the highlighted folder (and lists its
 * children), Esc closes the dropdown. With nothing highlighted, Tab moves on and Enter submits the form as usual.
 */
export function PathInput({ host, home, value, onChange, placeholder, autoFocus }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  // Listings by host and folder, so typing more of a name does not re-run ls over SSH.
  const cache = useRef(new Map<string, Entry[]>());
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setSelected(-1);
    const split = splitDirPrefix(expandHome(value, home));
    if (!host || !split) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { dir, prefix } = split;
    const key = `${host}\0${dir}`;
    const hit = cache.current.get(key);
    if (hit) {
      setItems(dirSuggestions(hit, dir, prefix));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .listRemoteDir(host, dir)
        .then((entries) => {
          cache.current.set(key, entries);
          if (!cancelled) setItems(dirSuggestions(entries, dir, prefix));
        })
        .catch(() => !cancelled && setItems([]))
        .finally(() => !cancelled && setLoading(false));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [host, home, value]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  function complete(abs: string) {
    // Keep the `~` form when the user typed it.
    onChange(`${value.startsWith('~') ? contractHome(abs, home) : abs}/`);
    setOpen(true);
  }

  const listable = splitDirPrefix(expandHome(value, home)) !== null;
  const dropdown = open && (items.length > 0 || loading || listable);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const shown = open && items.length > 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (!items.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((i) => (i < 0 && step < 0 ? items.length - 1 : (i + step + items.length) % items.length));
    } else if ((e.key === 'Tab' || e.key === 'Enter') && shown && selected >= 0 && !e.shiftKey) {
      e.preventDefault();
      complete(items[selected]);
    } else if (e.key === 'Escape' && dropdown) {
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="path-input">
      <input
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          const end = e.target.value.length;
          e.target.setSelectionRange(end, end);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {dropdown && (
        <ul className="path-suggestions" role="listbox" ref={listRef}>
          {items.map((p, i) => (
            <li
              key={p}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : ''}
              // mousedown keeps focus in the input; click completes.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSelected(i)}
              onClick={() => complete(p)}
            >
              {basename(p)}/
            </li>
          ))}
          {!items.length && <li className="muted">{loading ? 'Loading…' : 'No folders'}</li>}
        </ul>
      )}
    </div>
  );
}
