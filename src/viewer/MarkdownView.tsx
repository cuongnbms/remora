import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useRef, useState } from 'react';
import { useIsDark } from '../hooks/usePrefersDark';
import { api } from '../lib/api';
import { renderMarkdown, type Rendered } from '../lib/markdown';
import { renderMermaid } from '../lib/mermaid';
import { isExternal, resolveRel, splitHash } from '../lib/paths';
import type { Project } from '../lib/types';
import { useStore } from '../store';
import { DiagramZoom } from './DiagramZoom';
import { Toc } from './Toc';

export function scrollToId(root: HTMLElement | null, id: string) {
  root?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'start' });
}

type Props = {
  project: Project;
  path: string;
  source: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onRendered: () => void;
  showToc: boolean;
  // Reports whether the document has headings, so the toolbar knows to offer the contents toggle.
  onTocChange: (hasToc: boolean) => void;
};

export function MarkdownView({ project, path, source, scrollRef, onRendered, showToc, onTocChange }: Props) {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<SVGSVGElement | null>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const dark = useIsDark();
  const pendingHash = useStore((s) => s.pendingHash);

  useEffect(() => {
    let cancelled = false;
    renderMarkdown(source).then((r) => {
      if (!cancelled) setRendered(r);
    });
    return () => {
      cancelled = true;
    };
    // Re-rendering on a theme change redraws mermaid diagrams with the matching palette.
  }, [source, dark]);

  // After each render: draw mermaid, fetch relative images, restore scroll.
  useEffect(() => {
    const body = bodyRef.current;
    if (!rendered || !body) return;
    void renderMermaid(body, dark);
    body.querySelectorAll<HTMLImageElement>('img[data-rel-src]').forEach((img) => {
      const relSrc = img.dataset.relSrc ?? '';
      const rel = resolveRel(path, relSrc);
      if (rel === null) return;
      api
        .readImage(project.id, rel)
        .then((url) => {
          img.src = url;
        })
        .catch(() => {
          img.alt = `[image not found: ${relSrc}]`;
        });
    });
    if (!useStore.getState().pendingHash) onRendered();
    // Mermaid blocks are replaced in place, so this runs once per render; a theme change
    // re-renders the markdown (see above) to redraw them with the new palette.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered]);

  // A reload or theme change redraws the document, so the zoomed copy would be stale.
  useEffect(() => setZoomed(null), [rendered]);

  useEffect(() => {
    if (!pendingHash || !rendered) return;
    scrollToId(bodyRef.current, pendingHash);
    useStore.getState().consumeHash();
  }, [pendingHash, rendered]);

  const onScroll = () => {
    const sc = scrollRef.current;
    const body = bodyRef.current;
    if (!sc || !body || !rendered) return;
    let current: string | null = null;
    for (const item of rendered.toc) {
      const h = body.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);
      if (h && h.offsetTop <= sc.scrollTop + 80) current = item.id;
    }
    setActiveId(current);
  };

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href) {
      const diagram = (e.target as Element).closest('.mermaid-svg')?.querySelector('svg');
      if (diagram) setZoomed(diagram);
      return;
    }
    e.preventDefault();
    if (href.startsWith('#')) {
      scrollToId(bodyRef.current, decodeURIComponent(href.slice(1)));
      return;
    }
    if (isExternal(href)) {
      void openUrl(href).catch(() => {});
      return;
    }
    const [target, hash] = splitHash(href);
    const rel = resolveRel(path, target);
    if (rel !== null) useStore.getState().openFile(rel, hash ? decodeURIComponent(hash) : undefined);
  };

  const hasToc = !!rendered && rendered.toc.length > 0;
  useEffect(() => onTocChange(hasToc), [hasToc, onTocChange]);

  return (
    <div className="md-layout">
      {showToc && rendered && hasToc && (
        <Toc items={rendered.toc} activeId={activeId} onSelect={(id) => scrollToId(bodyRef.current, id)} />
      )}
      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        {rendered ? (
          <article className="markdown-body" ref={bodyRef} onClick={onClick} dangerouslySetInnerHTML={{ __html: rendered.html }} />
        ) : (
          <p className="muted pad">Rendering…</p>
        )}
      </div>
      {zoomed && <DiagramZoom svg={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}
