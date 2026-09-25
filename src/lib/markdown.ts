import DOMPurify from 'dompurify';
import MarkdownIt, { type MarkdownIt as MarkdownItType } from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import { ensureLangs, getHighlighter, highlightSync } from './highlight';
import { isExternal } from './paths';

export type TocItem = { level: number; text: string; id: string };
export type Rendered = { html: string; toc: TocItem[] };

/** Marker carrying the Mermaid source index; replaced by the real source after sanitizing. */
const MERMAID_INDEX_ATTR = 'data-mermaid-index';
/** Applied to heading slugs that would otherwise shadow a document/form property. */
const CLOBBER_PREFIX = 'user-content-';

let clobberProbe: HTMLFormElement | null = null;

/**
 * True when `id` would shadow a `document` or form property — exactly the case DOMPurify's
 * default `SANITIZE_DOM` protection rejects. Slugifying against this keeps heading ids that
 * the TOC depends on without reattaching anything DOMPurify chose to drop.
 */
function clobbersDocument(id: string): boolean {
  const probe = clobberProbe ?? (clobberProbe = document.createElement('form'));
  return id in document || id in probe;
}

const slugify = (s: string) => {
  const base = s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
  return clobbersDocument(base) ? `${CLOBBER_PREFIX}${base}` : base;
};

function createMd(highlight: (code: string, lang: string) => string, mermaidSources: string[]): MarkdownItType {
  let md: MarkdownItType;
  md = new MarkdownIt({
    html: true,
    linkify: true,
    highlight: (code: string, lang: string) => {
      if (lang === 'mermaid') {
        // Keep the source out of the HTML so sanitizing never has to touch it; the index is
        // rehydrated below, after DOMPurify has run with its default protections intact.
        const index = mermaidSources.push(code) - 1;
        return `<pre class="mermaid-block" ${MERMAID_INDEX_ATTR}="${index}"></pre>`;
      }
      return highlight(code, lang);
    },
  });
  // Plugins ship declarations built against @types/markdown-it@14 while the runtime is
  // markdown-it@15 (which bundles its own types), so bridge the two plugin signatures here.
  const usePlugin = (plugin: unknown, ...params: unknown[]) => {
    md.use(plugin as (instance: MarkdownItType, ...args: unknown[]) => void, ...params);
  };
  usePlugin(anchor, { slugify });
  usePlugin(footnote);
  usePlugin(taskLists, { enabled: false });

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = String(token.attrGet('src') ?? '');
    if (src && !isExternal(src)) {
      token.attrSet('data-rel-src', src);
      token.attrSet('src', '');
    }
    return defaultImage(tokens, idx, options, env, self);
  };
  return md;
}

/**
 * Put the Mermaid source back after sanitizing. The source never enters the HTML (the fence
 * only carries an index) because DOMPurify rejects `-->` in attribute values as an XML comment
 * terminator. Heading ids need no such treatment: `slugify` makes them collision-safe up front,
 * so DOMPurify's default protections leave them in place.
 */
function reattachMermaidSources(clean: string, sources: string[]): string {
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll<HTMLElement>(`pre.mermaid-block[${MERMAID_INDEX_ATTR}]`).forEach((el) => {
    const source = sources[Number(el.getAttribute(MERMAID_INDEX_ATTR))];
    el.removeAttribute(MERMAID_INDEX_ATTR);
    el.setAttribute('data-mermaid', source ?? '');
  });
  return doc.body.innerHTML;
}

export async function renderMarkdown(src: string): Promise<Rendered> {
  const hl = await getHighlighter();
  const mermaidSources: string[] = [];
  const md = createMd((code, lang) => highlightSync(hl, code, lang), mermaidSources);
  const env = {};
  const tokens = md.parse(src, env);

  await ensureLangs(
    hl,
    tokens.filter((t) => t.type === 'fence').map((t) => t.info.trim().split(/\s+/)[0]),
  );

  const toc: TocItem[] = [];
  tokens.forEach((t, i) => {
    if (t.type !== 'heading_open') return;
    const level = Number(t.tag.slice(1));
    if (level > 4) return;
    const inline = tokens[i + 1];
    const text = (inline.children ?? [])
      .filter((c) => c.type === 'text' || c.type === 'code_inline')
      .map((c) => c.content)
      .join('');
    toc.push({ level, text, id: String(t.attrGet('id') ?? '') });
  });

  const html = md.renderer.render(tokens, md.options, env);
  return { html: reattachMermaidSources(DOMPurify.sanitize(html), mermaidSources), toc };
}
