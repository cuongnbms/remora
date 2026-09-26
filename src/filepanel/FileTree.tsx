import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, type MenuState } from '../components/ContextMenu';
import { ErrorState, useHostDown } from '../components/ErrorState';
import { api, errorKind, errorMessage } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { findProject } from '../lib/configOps';
import { dropDirAt } from '../lib/dropTarget';
import { isConnectionError } from '../lib/errors';
import { absPath } from '../lib/project';
import { startDownload, startUpload } from '../lib/transfer';
import { dirsToRefresh } from '../lib/tree';
import type { AppErrorKind, Entry } from '../lib/types';
import { useStore } from '../store';
import { ChevronIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, FileIcon, FolderIcon } from './icons';

const HIDDEN = new Set(['.git', 'node_modules']);
type DirState = Entry[] | { error: string; kind: AppErrorKind | null };

export function FileTree({ projectId }: { projectId: string }) {
  const [children, setChildren] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [showHidden, setShowHidden] = useState(false);
  const activePath = useStore((s) => s.views[projectId]?.active ?? null);
  const batch = useStore((s) => s.lastBatch);
  const reloadSeq = useStore((s) => s.reloadSeq);
  const host = useStore((s) => findProject(s.config, projectId)?.host);
  const hostDown = useHostDown(host);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  // Bumped per directory on every load and on every invalidation, so a response that lands after a
  // newer request (or after the cached entry was dropped) cannot write stale entries back.
  const loadSeq = useRef<Record<string, number>>({});
  // Folder a Finder drag is hovering ("" is the root), or null when not over the tree.
  const [dropDir, setDropDir] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    // Tauri reports positions in physical pixels relative to the webview.
    const dirAt = (p: { x: number; y: number }) =>
      dropDirAt(document.elementFromPoint(p.x / window.devicePixelRatio, p.y / window.devicePixelRatio));
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter' || payload.type === 'over') {
          setDropDir(dirAt(payload.position));
        } else if (payload.type === 'drop') {
          const dir = dirAt(payload.position);
          setDropDir(null);
          if (dir !== null) void startUpload(projectId, dir, payload.paths);
        } else {
          setDropDir(null);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => console.error('drag-drop listener failed', e));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [projectId]);

  const rowMenu = (e: React.MouseEvent, rel: string) => {
    e.preventDefault();
    const project = findProject(useStore.getState().config, projectId);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Copy Path', icon: <CopyIcon />, disabled: !project, onSelect: () => project && void copyText(absPath(project, rel), 'path') },
        { label: 'Copy Relative Path', icon: <CopyIcon />, onSelect: () => void copyText(rel, 'relative path') },
        'separator',
        { label: 'Download', icon: <DownloadIcon />, onSelect: () => void startDownload(projectId, rel) },
      ],
    });
  };

  const load = useCallback(
    async (dir: string) => {
      const seq = (loadSeq.current[dir] ?? 0) + 1;
      loadSeq.current[dir] = seq;
      try {
        const entries = await api.listDir(projectId, dir);
        if (loadSeq.current[dir] !== seq) return;
        setChildren((c) => ({ ...c, [dir]: entries }));
      } catch (e) {
        if (loadSeq.current[dir] !== seq) return;
        setChildren((c) => ({ ...c, [dir]: { error: errorMessage(e), kind: errorKind(e) } }));
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  useEffect(() => {
    if (!reloadSeq) return;
    const open = expandedRef.current;
    // Collapsed folders drop their cache (possibly a stale error) and reload on the next expand.
    setChildren((c) => Object.fromEntries(Object.entries(c).filter(([dir]) => open.has(dir))));
    for (const dir of open) void load(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSeq]);

  useEffect(() => {
    if (!batch || batch.projectId !== projectId) return;
    const dropped: string[] = [];
    for (const dir of dirsToRefresh(batch.changes)) {
      if (expandedRef.current.has(dir)) {
        void load(dir);
      } else {
        // Collapsed: keep no cache, so the next expand reloads instead of showing pre-change
        // entries. Invalidating the load sequence also discards an in-flight request for this dir.
        loadSeq.current[dir] = (loadSeq.current[dir] ?? 0) + 1;
        dropped.push(dir);
      }
    }
    if (dropped.length) {
      const gone = new Set(dropped);
      setChildren((c) =>
        dropped.some((dir) => dir in c)
          ? Object.fromEntries(Object.entries(c).filter(([dir]) => !gone.has(dir)))
          : c,
      );
    }
  }, [batch, projectId, load]);

  const toggle = (dir: string) => {
    const opening = !expanded.has(dir);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (opening) next.add(dir);
      else next.delete(dir);
      return next;
    });
    if (opening && !children[dir]) void load(dir);
  };

  const renderDir = (dir: string, depth: number): ReactNode => {
    const state = children[dir];
    const indent = { paddingLeft: 8 + depth * 12 };
    if (!state) return <div className="tree-row muted" style={indent}>Loading…</div>;
    if ('error' in state) {
      // The viewer's connection banner already carries the ssh detail and a retry.
      if (hostDown && isConnectionError(state.kind)) {
        return dir === '' ? (
          <ErrorState quiet title={`Waiting for ${host} to reconnect…`} />
        ) : (
          <div className="tree-row muted" style={indent}>Waiting for reconnect…</div>
        );
      }
      if (dir === '') {
        return state.kind === 'NotFound' ? (
          <ErrorState
            title="Project folder not found"
            detail={state.error}
            action={<button onClick={() => useStore.getState().requestEditProject(projectId)}>Edit project</button>}
          />
        ) : (
          <ErrorState
            title={isConnectionError(state.kind) ? `Can’t reach ${host}` : 'Can’t list files'}
            detail={state.error}
            action={<button onClick={() => void load('')}>Retry</button>}
          />
        );
      }
      return (
        <div className="tree-row error" style={indent} title={state.error} onClick={() => void load(dir)}>
          Couldn’t load — click to retry
        </div>
      );
    }
    return state
      .filter((e) => !e.name.startsWith('.remora-') && (showHidden || !HIDDEN.has(e.name)))
      .map((e) => {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.kind === 'dir') {
          const open = expanded.has(rel);
          return (
            <Fragment key={rel}>
              <div
                className={'tree-row dir' + (open ? ' open' : '') + (dropDir === rel ? ' drop-target' : '')}
                style={indent}
                data-drop-dir={rel}
                onClick={() => toggle(rel)}
                onContextMenu={(e) => rowMenu(e, rel)}
                title={rel}
              >
                <ChevronIcon />
                <FolderIcon open={open} />
                <span className="name">{e.name}</span>
              </div>
              {open && renderDir(rel, depth + 1)}
            </Fragment>
          );
        }
        return (
          <div
            key={rel}
            className={'tree-row file' + (rel === activePath ? ' active' : '')}
            style={indent}
            data-drop-dir={dir}
            title={rel}
            onClick={() => useStore.getState().openFile(rel)}
            onDoubleClick={() => useStore.getState().openFile(rel, undefined, { pin: true })}
            onContextMenu={(e) => rowMenu(e, rel)}
          >
            <span className="icon-spacer" />
            <FileIcon />
            <span className="name">{e.name}</span>
          </div>
        );
      });
  };

  return (
    <div className="tree" data-drop-dir="">
      <div className={'section-title' + (dropDir === '' ? ' drop-target' : '')}>
        <span>Files</span>
        <button
          className={'icon-btn' + (showHidden ? ' on' : '')}
          title={showHidden ? 'Hide .git and node_modules' : 'Show .git and node_modules'}
          aria-label="Show hidden"
          aria-pressed={showHidden}
          onClick={() => setShowHidden((v) => !v)}
        >
          {showHidden ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      </div>
      {renderDir('', 0)}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}
