import type { ProjectOrder, Settings, ThemeMode } from './types';

// Keep in sync with src-tauri/src/config.rs.
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const DEFAULT_EXCLUDES = [
  '.git', 'node_modules', 'dist', 'target', '.venv', 'venv', '__pycache__', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', '.tox', '.next', '.nuxt', '.gradle', '.idea', 'build',
];
export const DEFAULT_SETTINGS: Settings = { theme: 'system', uiFont: null, codeFont: null, fontSize: 13, excludes: DEFAULT_EXCLUDES, projectOrder: 'manual' };

const CACHE_KEY = 'remora.settings';
const THEMES: ThemeMode[] = ['system', 'light', 'dark'];
const ORDERS: ProjectOrder[] = ['manual', 'name'];

export function isDark(theme: ThemeMode, systemDark: boolean): boolean {
  return theme === 'system' ? systemDark : theme === 'dark';
}

/** A CSS font-family value: the chosen family as a quoted string, then the generic fallback. */
export function fontStack(family: string, fallback: string): string {
  return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", ${fallback}`;
}

/** Push settings onto the document; the stylesheet reads `data-theme` and the `--font-*` variables. */
export function applySettings(s: Settings, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = s.theme;
  root.style.setProperty('--font-size', `${s.fontSize}px`);
  const setFont = (name: string, family: string | null, fallback: string) => {
    if (family) root.style.setProperty(name, fontStack(family, fallback));
    else root.style.removeProperty(name);
  };
  setFont('--font-ui', s.uiFont, 'sans-serif');
  setFont('--font-code', s.codeFont, 'monospace');
}

/** Excluded names from the settings text box: one per line, trimmed, blanks and repeats dropped. */
export function parseExcludes(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

/** Settings as cached; `excludes` and `projectOrder` are optional because caches from older versions lack them. */
function isSettings(v: unknown): v is Omit<Settings, 'excludes' | 'projectOrder'> & Partial<Pick<Settings, 'excludes' | 'projectOrder'>> {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const font = (f: unknown) => f === null || typeof f === 'string';
  return (
    THEMES.includes(s.theme as ThemeMode) &&
    font(s.uiFont) &&
    font(s.codeFont) &&
    typeof s.fontSize === 'number' &&
    s.fontSize >= MIN_FONT_SIZE &&
    s.fontSize <= MAX_FONT_SIZE &&
    (s.excludes === undefined || (Array.isArray(s.excludes) && s.excludes.every((n) => typeof n === 'string'))) &&
    (s.projectOrder === undefined || ORDERS.includes(s.projectOrder as ProjectOrder))
  );
}

/** Last applied settings, used at startup to paint the right theme before config.json loads. */
export function readCachedSettings(): Settings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    return isSettings(parsed) ? { ...DEFAULT_SETTINGS, ...parsed } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function cacheSettings(s: Settings): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: only costs a theme flash on next launch */
  }
}
