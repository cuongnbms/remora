import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Change, Config, Entry } from '../lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { listDir, listFiles, startUpload, startDownload, drag } = vi.hoisted(() => ({
  listDir: vi.fn(),
  listFiles: vi.fn(),
  startUpload: vi.fn(async (_p: string, _d: string, _s: string[]) => undefined),
  startDownload: vi.fn(async (_p: string, _r: string) => undefined),
  drag: { handler: null as null | ((e: { payload: unknown }) => void) },
}));

vi.mock('../lib/api', () => ({
  api: { listDir, listFiles, saveConfig: vi.fn(async () => undefined) },
  errorMessage: (e: unknown) =>
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e),
  errorKind: (e: unknown) => (e && typeof e === 'object' && 'kind' in e ? (e as { kind: unknown }).kind : null),
}));
vi.mock('../lib/transfer', () => ({ startUpload, startDownload }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: (e: { payload: unknown }) => void) => {
      drag.handler = cb;
      return () => {
        if (drag.handler === cb) drag.handler = null;
      };
    },
  }),
}));

import { FilePanel } from './FilePanel';
import { useStore } from '../store';
import { DEFAULT_SETTINGS } from '../lib/settings';

const config: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    {
      id: 'g1',
      name: 'G',
      collapsed: false,
      projects: [{ id: 'p1', name: 'my-repo', host: 'devbox', path: '/w/bm' }],
    },
  ],
};

const file = (name: string, kind: 'file' | 'dir' = 'file'): Entry => ({ name, kind, symlink: false, size: 1, mtime: 1 });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const notFound = () => Object.assign(new Error('not found'), { kind: 'NotFound' });

let container: HTMLDivElement;
let root: Root;

const render = () => act(async () => { root.render(createElement(FilePanel)); await flush(); });
const apply = (projectId: string, changes: Change[]) =>
  act(async () => { useStore.getState().applyChanges(projectId, changes); await flush(); });
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); await flush(); });
const byTitle = (t: string) => container.querySelector(`[title="${t}"]`);
const treeLabels = () => [...container.querySelectorAll('.tree-row')].map((r) => r.textContent ?? '');
const iconOf = (t: string) =>
  [...(byTitle(t)?.querySelectorAll('[data-icon]') ?? [])].map((i) => i.getAttribute('data-icon'));
const setInput = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listDir.mockResolvedValue([]);
  listFiles.mockResolvedValue([]);
  useStore.setState({
    ready: false,
    config: { version: 1, groups: [], settings: DEFAULT_SETTINGS },
    activeProjectId: null,
    views: {},
    hosts: {},
    lastBatch: null,
    pendingHash: null,
    toast: null,
    quickOpen: false,
    reloadSeq: 0,
    editRequest: null,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const selectProject = () => {
  useStore.getState().init(config, null);
  useStore.getState().selectProject('p1');
};

describe('FilePanel', () => {
  test('prompts to select a project when none is active', async () => {
    useStore.getState().init(config, null);
    await render();
    expect(container.textContent).toContain('Select a project');
    expect(listDir).not.toHaveBeenCalled();
  });

  test('shows the project header and lazily loads the root from list_dir', async () => {
    selectProject();
    listDir.mockResolvedValue([file('docs', 'dir'), file('a.md')]);
    await render();

    expect(container.querySelector('.panel-header')?.textContent).toBe('my-repo');
    expect(container.querySelector('.panel-header')?.getAttribute('title')).toBe('devbox:/w/bm');
    expect(listDir).toHaveBeenCalledTimes(1);
    expect(listDir).toHaveBeenCalledWith('p1', '');
    expect(treeLabels()).toEqual(['docs', 'a.md']);
  });

  test('hides .git and node_modules until the show-hidden toggle is on', async () => {
    selectProject();
    listDir.mockResolvedValue([file('.git', 'dir'), file('node_modules', 'dir'), file('src', 'dir'), file('a.md')]);
    await render();
    expect(treeLabels()).toEqual(['src', 'a.md']);

    await click(container.querySelector('button[aria-label="Show hidden"]')!);
    expect(treeLabels()).toEqual(['.git', 'node_modules', 'src', 'a.md']);
  });

  test('expanding a directory loads it once and toggling again collapses it', async () => {
    selectProject();
    listDir.mockImplementation(async (_id: string, rel: string) =>
      rel === '' ? [file('docs', 'dir')] : [file('nested.md')],
    );
    await render();

    await click(byTitle('docs')!);
    expect(listDir).toHaveBeenCalledWith('p1', 'docs');
    expect(treeLabels()).toEqual(['docs', 'nested.md']);

    await click(byTitle('docs')!);
    expect(treeLabels()).toEqual(['docs']);
    expect(listDir).toHaveBeenCalledTimes(2);
  });

  test('rows show a chevron and folder icon that follow the open state, and files show a file icon', async () => {
    selectProject();
    listDir.mockImplementation(async (_id: string, rel: string) =>
      rel === '' ? [file('docs', 'dir'), file('a.md')] : [file('nested.md')],
    );
    await render();

    expect(iconOf('docs')).toEqual(['chevron', 'folder']);
    expect(byTitle('docs')!.classList.contains('open')).toBe(false);
    expect(iconOf('a.md')).toEqual(['file']);

    await click(byTitle('docs')!);
    expect(iconOf('docs')).toEqual(['chevron', 'folder-open']);
    expect(byTitle('docs')!.classList.contains('open')).toBe(true);
    expect(iconOf('docs/nested.md')).toEqual(['file']);
  });

  test('a change batch reloads only expanded directories and drops removed files', async () => {
    selectProject();
    let docs = [file('old.md')];
    listDir.mockImplementation(async (_id: string, rel: string) => (rel === '' ? [file('docs', 'dir')] : docs));
    await render();
    await click(byTitle('docs')!);
    expect(treeLabels()).toEqual(['docs', 'old.md']);

    // Polling never sets removed: true; the parent dir mtime bump drives the refresh.
    docs = [file('new.md')];
    await apply('p1', [{ path: 'docs', isDir: true, removed: false }]);
    expect(treeLabels()).toEqual(['docs', 'new.md']);

    // A batch for another project must not refetch this project's tree.
    const before = listDir.mock.calls.length;
    await apply('other', [{ path: 'docs', isDir: true, removed: false }]);
    expect(listDir.mock.calls.length).toBe(before);
  });

  test('a batch marked as the project root reloads the root', async () => {
    selectProject();
    listDir.mockResolvedValue([file('a.md')]);
    await render();

    listDir.mockResolvedValue([file('a.md'), file('b.md')]);
    await apply('p1', [{ path: '', isDir: true, removed: false }]);
    expect(treeLabels()).toEqual(['a.md', 'b.md']);
  });

  test('a change to a collapsed but loaded directory drops its cache so reopening reloads', async () => {
    selectProject();
    let docs = [file('old.md')];
    listDir.mockImplementation(async (_id: string, rel: string) => (rel === '' ? [file('docs', 'dir')] : docs));
    const docsCalls = () => listDir.mock.calls.filter((c) => c[1] === 'docs').length;
    await render();

    await click(byTitle('docs')!);
    expect(treeLabels()).toEqual(['docs', 'old.md']);
    expect(docsCalls()).toBe(1);

    await click(byTitle('docs')!);
    expect(docsCalls()).toBe(1);

    docs = [file('new.md')];
    await apply('p1', [{ path: 'docs', isDir: true, removed: false }]);
    // Nothing to refetch while collapsed; the cache is dropped instead.
    expect(docsCalls()).toBe(1);

    await click(byTitle('docs')!);
    expect(docsCalls()).toBe(2);
    expect(treeLabels()).toEqual(['docs', 'new.md']);
  });

  test('a stale in-flight directory response cannot overwrite a newer one', async () => {
    selectProject();
    let resolveFirst: (entries: Entry[]) => void = () => {};
    listDir.mockImplementationOnce(() => new Promise<Entry[]>((resolve) => { resolveFirst = resolve; }));
    listDir.mockResolvedValue([file('fresh.md')]);
    await render();
    expect(treeLabels()).toEqual(['Loading…']);

    // The expanded root issues a newer request while the first one is still pending.
    await apply('p1', [{ path: '', isDir: true, removed: false }]);
    expect(treeLabels()).toEqual(['fresh.md']);

    await act(async () => {
      resolveFirst([file('stale.md')]);
      await flush();
    });
    expect(treeLabels()).toEqual(['fresh.md']);
  });

  test('find files loads the list lazily, fuzzy-matches and opens the first result on Enter', async () => {
    selectProject();
    listDir.mockResolvedValue([file('a.md')]);
    listFiles.mockResolvedValue(['docs/other.md', 'docs/architecture-current.md']);
    await render();
    expect(listFiles).toHaveBeenCalledWith('p1');

    const input = container.querySelector('input.find') as HTMLInputElement;
    await act(async () => {
      setInput(input, 'archcur');
      await flush();
    });

    const results = [...container.querySelectorAll('.file-results li')];
    expect(results.map((r) => r.textContent)).toEqual(['architecture-current.mddocs']);

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(useStore.getState().views.p1.active).toBe('docs/architecture-current.md');
    expect((container.querySelector('input.find') as HTMLInputElement).value).toBe('');
    expect(container.querySelector('.tree')).not.toBeNull();
  });

  test('a stale listFiles response from an old path cannot overwrite the new path results', async () => {
    selectProject();
    listDir.mockResolvedValue([file('a.md')]);
    let resolveOld: (list: string[]) => void = () => {};
    listFiles.mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveOld = resolve; }));
    listFiles.mockResolvedValue(['new/path.md']);
    await render();
    expect(listFiles).toHaveBeenCalledWith('p1');
    expect(listFiles).toHaveBeenCalledTimes(1);

    // Editing the project path remounts ProjectFiles, which issues a second listFiles.
    await act(async () => {
      useStore.setState({
        config: {
          version: 1,
          settings: DEFAULT_SETTINGS,
          groups: [
            {
              id: 'g1',
              name: 'G',
              collapsed: false,
              projects: [{ id: 'p1', name: 'my-repo', host: 'devbox', path: '/w/other' }],
            },
          ],
        },
      });
      await flush();
    });
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(useStore.getState().views.p1.files).toEqual(['new/path.md']);

    // The old path's response lands last and must be discarded.
    await act(async () => {
      resolveOld(['old/path.md']);
      await flush();
    });
    expect(useStore.getState().views.p1.files).toEqual(['new/path.md']);
  });

  test('an invalidation while listFiles is in flight discards it and fetches a fresh list', async () => {
    selectProject();
    let resolveStale: (list: string[]) => void = () => {};
    listFiles.mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveStale = resolve; }));
    listFiles.mockResolvedValue(['fresh.md']);
    await render();
    expect(listFiles).toHaveBeenCalledTimes(1);

    await apply('p1', [{ path: 'new.md', isDir: false, removed: false }]);
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(useStore.getState().views.p1.files).toEqual(['fresh.md']);

    await act(async () => {
      resolveStale(['stale.md']);
      await flush();
    });
    expect(useStore.getState().views.p1.files).toEqual(['fresh.md']);
  });

  test('a project with a missing root shows the NotFound message and requests an edit', async () => {
    selectProject();
    listDir.mockRejectedValue(notFound());
    await render();

    expect(container.querySelector('.pad.error')?.textContent).toContain('Path not found.');
    await click(container.querySelector('.pad.error button')!);
    expect(useStore.getState().editRequest).toBe('p1');
  });

  test('a non-NotFound directory error is shown inline', async () => {
    selectProject();
    listDir.mockRejectedValue(Object.assign(new Error('ssh failed'), { kind: 'Ssh' }));
    await render();

    expect(container.querySelector('.tree .error')?.textContent).toBe('ssh failed');
    expect(container.querySelector('.pad.error')).toBeNull();
  });

  test('the active tree row is highlighted', async () => {
    selectProject();
    listDir.mockResolvedValue([file('a.md'), file('b.md')]);
    await render();

    await click(byTitle('a.md')!);
    expect(container.querySelector('.tree-row.file.active')?.textContent).toBe('a.md');
  });
});

describe('FileTree transfers', () => {
  const pointAt = (el: Element | null) => {
    document.elementFromPoint = vi.fn(() => el);
  };
  const fire = (payload: unknown) => act(async () => { drag.handler?.({ payload }); await flush(); });
  const tree = async () => {
    selectProject();
    listDir.mockImplementation(async (_id: string, rel: string) =>
      rel === '' ? [file('docs', 'dir'), file('a.md')] : [file('nested.md')],
    );
    await render();
    await click(byTitle('docs')!);
  };

  test('dropping on a folder row uploads into that folder and highlights it while hovering', async () => {
    await tree();
    pointAt(byTitle('docs'));
    await fire({ type: 'enter', paths: ['/Users/me/a.png'], position: { x: 5, y: 5 } });
    expect(byTitle('docs')!.classList.contains('drop-target')).toBe(true);
    await fire({ type: 'drop', paths: ['/Users/me/a.png'], position: { x: 5, y: 5 } });
    expect(startUpload).toHaveBeenCalledWith('p1', 'docs', ['/Users/me/a.png']);
    expect(container.querySelector('.drop-target')).toBeNull();
  });

  test('dropping on a file row uploads into its folder', async () => {
    await tree();
    pointAt(byTitle('docs/nested.md')!.querySelector('.name'));
    await fire({ type: 'over', position: { x: 5, y: 5 } });
    expect(byTitle('docs')!.classList.contains('drop-target')).toBe(true);
    await fire({ type: 'drop', paths: ['/Users/me/a.png'], position: { x: 5, y: 5 } });
    expect(startUpload).toHaveBeenCalledWith('p1', 'docs', ['/Users/me/a.png']);
  });

  test('dropping on empty tree space uploads into the root and highlights the title', async () => {
    await tree();
    pointAt(container.querySelector('.tree'));
    await fire({ type: 'over', position: { x: 5, y: 5 } });
    expect(container.querySelector('.tree .section-title')!.classList.contains('drop-target')).toBe(true);
    await fire({ type: 'drop', paths: ['/Users/me/x'], position: { x: 5, y: 5 } });
    expect(startUpload).toHaveBeenCalledWith('p1', '', ['/Users/me/x']);
  });

  test('dropping outside the tree does nothing and leave clears the highlight', async () => {
    await tree();
    pointAt(byTitle('docs'));
    await fire({ type: 'over', position: { x: 5, y: 5 } });
    await fire({ type: 'leave' });
    expect(container.querySelector('.drop-target')).toBeNull();
    pointAt(document.body);
    await fire({ type: 'drop', paths: ['/Users/me/a.png'], position: { x: 5, y: 5 } });
    expect(startUpload).not.toHaveBeenCalled();
  });

  test('drop on an error row targets the root', async () => {
    selectProject();
    listDir.mockRejectedValue(Object.assign(new Error('Connection refused'), { kind: 'Ssh' }));
    await render();
    pointAt(container.querySelector('.tree-row.error'));
    await fire({ type: 'drop', paths: ['/Users/me/a.png'], position: { x: 5, y: 5 } });
    expect(startUpload).toHaveBeenCalledWith('p1', '', ['/Users/me/a.png']);
  });

  test('drop positions are converted from physical to CSS pixels', async () => {
    await tree();
    const original = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    pointAt(byTitle('docs'));
    await fire({ type: 'drop', paths: ['/Users/me/a.png'], position: { x: 40, y: 60 } });
    expect(document.elementFromPoint).toHaveBeenCalledWith(20, 30);
    Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
  });

  test('in-flight .remora-* staging dirs never show in the tree', async () => {
    selectProject();
    listDir.mockResolvedValue([file('.remora-upload.Ab12Cd', 'dir'), file('a.md')]);
    await render();
    expect(treeLabels()).toEqual(['a.md']);
    await click(container.querySelector('button[aria-label="Show hidden"]')!);
    expect(treeLabels()).toEqual(['a.md']);
  });

  test('right-click Download on a file or folder starts a download', async () => {
    await tree();
    for (const [title, rel] of [['docs/nested.md', 'docs/nested.md'], ['docs', 'docs']]) {
      await act(async () => {
        byTitle(title)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 3, clientY: 4 }));
        await flush();
      });
      const item = [...container.querySelectorAll('.context-menu li')].find((li) => li.textContent === 'Download')!;
      await click(item);
      expect(startDownload).toHaveBeenLastCalledWith('p1', rel);
      expect(container.querySelector('.context-menu')).toBeNull();
    }
  });
});
