import type { Entry } from './types';

/** `~` or `~/…` becomes a path under `home`; anything else (or an unknown home) is returned as is. */
export function expandHome(p: string, home: string | null): string {
  if (!home || !(p === '~' || p.startsWith('~/'))) return p;
  return home.replace(/\/+$/, '') + p.slice(1);
}

/** The inverse of `expandHome`: a path under `home` is written with a leading `~`. A root home is left alone. */
export function contractHome(abs: string, home: string | null): string {
  const root = home?.replace(/\/+$/, '');
  if (!root) return abs;
  if (abs === root) return '~';
  return abs.startsWith(`${root}/`) ? `~${abs.slice(root.length)}` : abs;
}

const LAST_HOST_KEY = 'remora.lastProjectHost';

/** Host of the last project added, so the add dialog starts there; null when storage is empty or blocked. */
export function loadLastHost(): string | null {
  try {
    return localStorage.getItem(LAST_HOST_KEY);
  } catch {
    return null;
  }
}

export function saveLastHost(host: string): void {
  try {
    localStorage.setItem(LAST_HOST_KEY, host);
  } catch {
    /* storage blocked: the dialog just starts on the default host */
  }
}

/** Folder being listed and the partial name typed after it; null for a relative path. */
export function splitDirPrefix(abs: string): { dir: string; prefix: string } | null {
  if (!abs.startsWith('/')) return null;
  const slash = abs.lastIndexOf('/');
  return { dir: abs.slice(0, slash) || '/', prefix: abs.slice(slash + 1) };
}

/** Absolute paths of the folders in `dir` whose name starts with `prefix` (any case); dotfolders only when typed. */
export function dirSuggestions(entries: Entry[], dir: string, prefix: string): string[] {
  const lower = prefix.toLowerCase();
  const base = dir === '/' ? '' : dir;
  return entries
    .filter((e) => e.kind === 'dir' && e.name.toLowerCase().startsWith(lower) && (prefix.startsWith('.') || !e.name.startsWith('.')))
    .slice(0, 50)
    .map((e) => `${base}/${e.name}`);
}
