import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from 'shiki';

let highlighter: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: ['github-light', 'github-dark'], langs: [] });
  return highlighter;
}

export async function ensureLangs(hl: Highlighter, langs: string[]): Promise<void> {
  const loaded = new Set(hl.getLoadedLanguages());
  const need = [...new Set(langs)].filter((l) => l && l in bundledLanguages && !loaded.has(l)) as BundledLanguage[];
  if (need.length) await hl.loadLanguage(...need);
}

export function highlightSync(hl: Highlighter, code: string, lang: string): string {
  const use = lang && hl.getLoadedLanguages().includes(lang) ? lang : 'text';
  return hl.codeToHtml(code, { lang: use, themes: { light: 'github-light', dark: 'github-dark' } });
}
