import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorKind, errorMessage } from '../lib/api';
import { dirname, isImage, isMarkdown } from '../lib/paths';
import { location } from '../lib/project';
import type { AppErrorKind, FileContent, Project } from '../lib/types';
import { useStore } from '../store';
import { CodeIcon, CopyIcon, EyeIcon, ListIcon } from '../filepanel/icons';
import { CodeView } from './CodeView';
import { MarkdownView } from './MarkdownView';

export function FileView({ project, path }: { project: Project; path: string }) {
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<{ kind: AppErrorKind | null; message: string } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const [showToc, setShowToc] = useState(true);
  const [hasToc, setHasToc] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef<number | null>(null);
  const hasData = useRef(false);
  // Reads can overlap (mount + a change batch + a manual reload); only the newest may write.
  const loadSeq = useRef(0);
  const batch = useStore((s) => s.lastBatch);
  const reloadSeq = useStore((s) => s.reloadSeq);
  const fullPath = `${project.path.replace(/\/$/, '')}/${path}`;
  const markdown = isMarkdown(path);
  const image = isImage(path);

  const load = useCallback(
    async (keepScroll: boolean) => {
      if (keepScroll && scrollRef.current) savedScroll.current = scrollRef.current.scrollTop;
      const seq = ++loadSeq.current;
      try {
        // An image's content is its data URL.
        const content = image ? { content: await api.readImage(project.id, path), truncated: false } : await api.readFile(project.id, path);
        if (seq !== loadSeq.current) return;
        hasData.current = true;
        setData(content);
        setError(null);
        setRemoved(false);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        const kind = errorKind(e);
        if (hasData.current) {
          // Keep showing the last good content while making reload failures visible.
          if (kind === 'NotFound') {
            setRemoved(true);
            setError(null);
          } else {
            setRemoved(false);
            setError({ kind, message: errorMessage(e) });
          }
        } else {
          setError({ kind, message: errorMessage(e) });
        }
      }
    },
    [project.id, path, image],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (reloadSeq) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSeq]);

  useEffect(() => {
    if (!batch || batch.projectId !== project.id) return;
    const parent = dirname(path);
    if (batch.changes.some((c) => c.path === path || (c.isDir && c.path === parent))) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch]);

  const onRendered = useCallback(() => {
    if (savedScroll.current !== null && scrollRef.current) {
      scrollRef.current.scrollTop = savedScroll.current;
      savedScroll.current = null;
    }
  }, []);

  const errorText = error?.kind === 'Binary' ? 'Binary file — not shown' : error?.message;
  let body: React.ReactNode;
  if (error && !data) body = <div className="pad error">{errorText}</div>;
  else if (!data) body = <div className="pad muted">Loading…</div>;
  else if (image)
    body = (
      <div className="image-view">
        <img src={data.content} alt={path} />
      </div>
    );
  else if (markdown && mode === 'rendered')
    body = (
      <MarkdownView
        project={project}
        path={path}
        source={data.content}
        scrollRef={scrollRef}
        onRendered={onRendered}
        showToc={showToc}
        onTocChange={setHasToc}
      />
    );
  else
    body = (
      <div className="scroll" ref={scrollRef}>
        <CodeView path={path} source={data.content} onRendered={onRendered} />
      </div>
    );

  return (
    <div className="fileview">
      <div className="breadcrumb">
        <span className="path" title={fullPath}>{location(project, fullPath)}</span>
        {markdown && mode === 'rendered' && hasToc && (
          <button
            className={'icon-btn' + (showToc ? ' on' : '')}
            title={showToc ? 'Hide contents' : 'Show contents'}
            aria-label="Contents"
            aria-pressed={showToc}
            onClick={() => setShowToc((v) => !v)}
          >
            <ListIcon />
          </button>
        )}
        <button className="icon-btn" title="Copy path" aria-label="Copy path" onClick={() => void navigator.clipboard.writeText(fullPath)}>
          <CopyIcon />
        </button>
        {markdown && (
          <button
            className="icon-btn"
            title={mode === 'rendered' ? 'Source' : 'Rendered'}
            aria-label={mode === 'rendered' ? 'Source' : 'Rendered'}
            onClick={() => setMode((m) => (m === 'rendered' ? 'source' : 'rendered'))}
          >
            {mode === 'rendered' ? <CodeIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {removed && <div className="banner warn">File removed — showing the last loaded content</div>}
      {data && error && <div className="banner error">Reload failed: {errorText} — showing the last loaded content</div>}
      {data?.truncated && <div className="banner warn">File is larger than 2 MB — showing the first 2 MB</div>}
      {body}
    </div>
  );
}
