import { useEffect, useLayoutEffect, useState } from 'react';
import { ensureLangs, getHighlighter, highlightSync } from '../lib/highlight';
import { langFromPath } from '../lib/paths';

const HIGHLIGHT_LIMIT = 300_000;

export function CodeView({ path, source, onRendered }: { path: string; source: string; onRendered: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const lang = langFromPath(path);
  const tooBig = source.length > HIGHLIGHT_LIMIT;

  useEffect(() => {
    if (tooBig) return;
    let cancelled = false;
    (async () => {
      const hl = await getHighlighter();
      await ensureLangs(hl, [lang]);
      if (!cancelled) setHtml(highlightSync(hl, source, lang));
    })();
    return () => {
      cancelled = true;
    };
  }, [source, lang, tooBig]);

  useLayoutEffect(() => {
    onRendered();
  }, [html, source, onRendered]);

  if (tooBig || html === null) return <pre className="plain-code">{source}</pre>;
  return <div className="code-view" dangerouslySetInnerHTML={{ __html: html }} />;
}
