import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DEFAULT_EXCLUDES, DEFAULT_SETTINGS, MAX_FONT_SIZE, MIN_FONT_SIZE, parseExcludes } from '../lib/settings';
import type { FontFamily, ThemeMode } from '../lib/types';
import { useStore } from '../store';

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const DEFAULT = '';

// Enumerating installed fonts takes ~0.5 s; do it once per app session.
let fontsRequest: Promise<FontFamily[]> | null = null;
function loadFonts(): Promise<FontFamily[]> {
  fontsRequest ??= api.listFonts().catch(() => {
    fontsRequest = null;
    return [];
  });
  return fontsRequest;
}

function FontSelect({ value, fonts, preferMono, onChange }: { value: string | null; fonts: FontFamily[] | null; preferMono: boolean; onChange: (v: string | null) => void }) {
  const known = fonts?.some((f) => f.family === value) ?? true;
  const option = (f: FontFamily) => <option key={f.family} value={f.family}>{f.family}</option>;
  return (
    <select value={value ?? DEFAULT} disabled={!fonts} onChange={(e) => onChange(e.target.value || null)}>
      <option value={DEFAULT}>{fonts ? 'Default' : 'Loading fonts…'}</option>
      {value && !known && <option value={value}>{value} (not installed)</option>}
      {fonts && preferMono ? (
        <>
          <optgroup label="Monospace">{fonts.filter((f) => f.monospace).map(option)}</optgroup>
          <optgroup label="Other">{fonts.filter((f) => !f.monospace).map(option)}</optgroup>
        </>
      ) : (
        fonts?.map(option)
      )}
    </select>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.config.settings);
  const { updateSettings } = useStore.getState();
  const [fonts, setFonts] = useState<FontFamily[] | null>(null);
  const [size, setSize] = useState(String(settings.fontSize));
  const [excludes, setExcludes] = useState(settings.excludes.join('\n'));

  useEffect(() => {
    let cancelled = false;
    void loadFonts().then((list) => {
      if (!cancelled) setFonts(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => setSize(String(settings.fontSize)), [settings.fontSize]);
  useEffect(() => setExcludes(settings.excludes.join('\n')), [settings.excludes]);

  const saveExcludes = () => {
    const list = parseExcludes(excludes);
    if (list.join('\n') === settings.excludes.join('\n')) setExcludes(list.join('\n'));
    else void updateSettings({ excludes: list });
  };

  const changeSize = (raw: string) => {
    setSize(raw);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE && n !== settings.fontSize) void updateSettings({ fontSize: n });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Settings</h3>
        <div className="field">
          <span className="field-label">Theme</span>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={settings.theme === t.value}
                className={settings.theme === t.value ? 'selected' : ''}
                autoFocus={settings.theme === t.value}
                onClick={() => void updateSettings({ theme: t.value })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <label>
          Interface font
          <FontSelect value={settings.uiFont} fonts={fonts} preferMono={false} onChange={(uiFont) => void updateSettings({ uiFont })} />
        </label>
        <label>
          Code font
          <FontSelect value={settings.codeFont} fonts={fonts} preferMono onChange={(codeFont) => void updateSettings({ codeFont })} />
        </label>
        <label>
          Font size ({MIN_FONT_SIZE}–{MAX_FONT_SIZE} px)
          <input type="number" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} value={size} onChange={(e) => changeSize(e.target.value)} onBlur={() => setSize(String(settings.fontSize))} />
        </label>
        <div className="field">
          <div className="field-row">
            <label className="field-label" htmlFor="settings-excludes">Excluded folders and files</label>
            <button type="button" className="link-btn" onClick={() => void updateSettings({ excludes: DEFAULT_EXCLUDES })}>Reset list</button>
          </div>
          <textarea id="settings-excludes" rows={6} spellCheck={false} value={excludes} onChange={(e) => setExcludes(e.target.value)} onBlur={saveExcludes} />
          <span className="field-hint">One name per line. Not watched and left out of Quick Open.</span>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={() => void updateSettings(DEFAULT_SETTINGS)}>Reset to defaults</button>
          <button type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
