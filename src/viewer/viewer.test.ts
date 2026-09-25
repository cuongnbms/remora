import { act, createElement, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Change, Config, Project } from '../lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { readFile, readImage, watchProject, unwatch, openUrl, renderMermaid } = vi.hoisted(() => ({
  readFile: vi.fn(),
  readImage: vi.fn(),
  watchProject: vi.fn(async (_projectId: string) => undefined),
  unwatch: vi.fn(async () => undefined),
  openUrl: vi.fn(async (_url: string) => undefined),
  renderMermaid: vi.fn(async (_root: HTMLElement, _dark: boolean) => undefined),
}));

vi.mock('../lib/api', () => ({
  api: { readFile, readImage, watchProject, unwatch },
  errorMessage: (e: unknown) =>
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e),
  errorKind: (e: unknown) => (e && typeof e === 'object' && 'kind' in e ? (e as { kind: unknown }).kind : null),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));
vi.mock('../lib/mermaid', () => ({ renderMermaid }));

import { useStore } from '../store';
import { CodeView } from './CodeView';
import { FileView } from './FileView';
import { MarkdownView } from './MarkdownView';
import { Tabs } from './Tabs';
import { Toc } from './Toc';
import { Viewer } from './Viewer';
import { DEFAULT_SETTINGS } from '../lib/settings';

const config: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    {
      id: 'g1',
      name: 'G',
      collapsed: false,
      subgroups: [],
      projects: [{ id: 'p1', name: 'my-repo', host: 'devbox', path: '/w/bm' }],
    },
  ],
};
const project: Project = config.groups[0].projects[0];

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const notFound = () => Object.assign(new Error('Path not found.'), { kind: 'NotFound' });

let container: HTMLDivElement;
let root: Root;
let dark = false;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  dark = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
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

const render = (el: ReactElement) =>
  act(async () => {
    root.render(el);
    await flush();
  });

/**
 * Render then wait until an async chain (shiki, markdown-it, image fetches) settles.
 * The poll yields out of `act` between checks: an update that lands inside an async `act`
 * scope is only committed when the scope exits, so polling from within it would never see it.
 */
const waitFor = async (assert: () => void) => {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      assert();
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    }
  }
};

const click = (el: Element) =>
  act(async () => {
    (el as HTMLElement).click();
    await flush();
  });

const apply = (projectId: string, changes: Change[]) =>
  act(async () => {
    useStore.getState().applyChanges(projectId, changes);
    await flush();
  });

const selectProject = () => {
  useStore.getState().init(config, null);
  useStore.getState().selectProject('p1');
};

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;

describe('Tabs', () => {
  test('renders nothing without tabs', async () => {
    await render(createElement(Tabs, { tabs: [], active: null, preview: null }));
    expect(container.textContent).toBe('');
  });

  test('shows basenames, marks the active tab and activates on click', async () => {
    selectProject();
    await render(createElement(Tabs, { tabs: ['docs/a.md', 'b.ts'], active: 'b.ts', preview: null }));

    const tabs = [...container.querySelectorAll<HTMLElement>('.tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['a.md', 'b.ts']);
    expect(tabs[0].className).toBe('tab');
    expect(tabs[1].className).toBe('tab active');
    expect(tabs[0].title).toBe('docs/a.md');

    await click(tabs[0]);
    expect(useStore.getState().views.p1.active).toBe('docs/a.md');
  });

  test('closes a tab from its close button without activating it', async () => {
    selectProject();
    useStore.setState({ views: { p1: { tabs: ['docs/a.md', 'b.ts'], active: 'b.ts', preview: null, files: null, filesGeneration: 0 } } });
    await render(createElement(Tabs, { tabs: ['docs/a.md', 'b.ts'], active: 'b.ts', preview: null }));

    await click(container.querySelectorAll('.tab')[0].querySelector('.tab-close')!);
    const view = useStore.getState().views.p1;
    expect(view.tabs).toEqual(['b.ts']);
    expect(view.active).toBe('b.ts');
  });

  test('italicizes the preview tab and pins it on double-click', async () => {
    selectProject();
    useStore.setState({ views: { p1: { tabs: ['a.md', 'b.ts'], active: 'b.ts', preview: 'b.ts', files: null, filesGeneration: 0 } } });
    await render(createElement(Tabs, { tabs: ['a.md', 'b.ts'], active: 'b.ts', preview: 'b.ts' }));

    const tab = container.querySelectorAll<HTMLElement>('.tab')[1];
    expect(tab.className).toBe('tab active preview');
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await flush();
    });
    expect(useStore.getState().views.p1.preview).toBeNull();
  });

  test('closes a tab on middle click', async () => {
    selectProject();
    useStore.setState({ views: { p1: { tabs: ['a.md', 'b.ts'], active: 'a.md', preview: null, files: null, filesGeneration: 0 } } });
    await render(createElement(Tabs, { tabs: ['a.md', 'b.ts'], active: 'a.md', preview: null }));

    await act(async () => {
      container.querySelectorAll('.tab')[1].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
      await flush();
    });
    expect(useStore.getState().views.p1.tabs).toEqual(['a.md']);
  });
});

describe('Toc', () => {
  const labels = () => [...container.querySelectorAll<HTMLElement>('.toc li')].map((i) => i.textContent);

  test('indents relative to the shallowest heading, marks the active item and reports clicks', async () => {
    const onSelect = vi.fn();
    await render(
      createElement(Toc, {
        items: [
          { level: 2, text: 'Intro', id: 'intro' },
          { level: 1, text: 'Top', id: 'top' },
          { level: 3, text: 'Deep', id: 'deep' },
        ],
        activeId: 'deep',
        onSelect,
      }),
    );

    const items = [...container.querySelectorAll<HTMLElement>('.toc li')];
    expect(labels()).toEqual(['Intro', 'Top', 'Deep']);
    expect(items.map((i) => i.style.paddingLeft)).toEqual(['18px', '4px', '32px']);
    expect(items.map((i) => i.className)).toEqual(['', '', 'active']);
    expect(container.querySelector('.section-title')).toBeNull();

    await click(items[0]);
    expect(onSelect).toHaveBeenCalledWith('intro');
  });

  test('collapses and expands a heading subtree without selecting it', async () => {
    const onSelect = vi.fn();
    await render(
      createElement(Toc, {
        items: [
          { level: 1, text: 'A', id: 'a' },
          { level: 2, text: 'A1', id: 'a1' },
          { level: 3, text: 'A1x', id: 'a1x' },
          { level: 2, text: 'A2', id: 'a2' },
          { level: 1, text: 'B', id: 'b' },
        ],
        activeId: null,
        onSelect,
      }),
    );
    const toggles = () => [...container.querySelectorAll<HTMLElement>('.toc-toggle[role=button]')];
    // Only headings with children get a toggle: A and A1.
    expect(toggles().length).toBe(2);

    await click(toggles()[1]);
    expect(labels()).toEqual(['A', 'A1', 'A2', 'B']);
    await click(toggles()[0]);
    expect(labels()).toEqual(['A', 'B']);
    await click(toggles()[0]);
    // Re-expanding A keeps A1's own collapsed state.
    expect(labels()).toEqual(['A', 'A1', 'A2', 'B']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('the H1/H2/H3 buttons collapse the outline to that heading level', async () => {
    await render(
      createElement(Toc, {
        items: [
          { level: 1, text: 'A', id: 'a' },
          { level: 2, text: 'A1', id: 'a1' },
          { level: 3, text: 'A1x', id: 'a1x' },
          { level: 4, text: 'A1x-deep', id: 'a1xd' },
          { level: 2, text: 'A2', id: 'a2' },
          { level: 1, text: 'B', id: 'b' },
        ],
        activeId: null,
        onSelect: vi.fn(),
      }),
    );
    const level = (n: number) => container.querySelector<HTMLElement>(`.toc-levels button[aria-label="Show up to H${n}"]`)!;

    await click(level(1));
    expect(labels()).toEqual(['A', 'B']);
    await click(level(2));
    expect(labels()).toEqual(['A', 'A1', 'A2', 'B']);
    await click(level(3));
    expect(labels()).toEqual(['A', 'A1', 'A1x', 'A2', 'B']);
    // A level button overrides earlier per-heading toggles.
    await click(container.querySelector<HTMLElement>('.toc-toggle[role=button]')!);
    expect(labels()).toEqual(['A', 'B']);
    await click(level(2));
    expect(labels()).toEqual(['A', 'A1', 'A2', 'B']);
  });

  test('resizes by dragging the handle, clamps, persists and resets on double-click', async () => {
    const renderToc = () =>
      render(createElement(Toc, { items: [{ level: 1, text: 'A', id: 'a' }], activeId: null, onSelect: vi.fn() }));
    const nav = () => container.querySelector<HTMLElement>('.toc')!;
    const handle = () => container.querySelector<HTMLElement>('.toc-resize')!;
    const pointer = (target: EventTarget, type: string, clientX: number) =>
      act(async () => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
        await flush();
      });

    await renderToc();
    expect(nav().style.width).toBe('240px');

    await pointer(handle(), 'pointerdown', 100);
    await pointer(window, 'pointermove', 160);
    expect(nav().style.width).toBe('300px');
    await pointer(window, 'pointerup', 160);
    expect(localStorage.getItem('remora.tocWidth')).toBe('300');

    // Moving after release does nothing; limits are 160..480.
    await pointer(window, 'pointermove', 400);
    expect(nav().style.width).toBe('300px');
    await pointer(handle(), 'pointerdown', 0);
    await pointer(window, 'pointermove', 1000);
    expect(nav().style.width).toBe('480px');
    await pointer(window, 'pointermove', -1000);
    expect(nav().style.width).toBe('160px');
    await pointer(window, 'pointerup', -1000);

    await renderToc();
    expect(nav().style.width).toBe('160px');

    await act(async () => {
      handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await flush();
    });
    expect(nav().style.width).toBe('240px');
    expect(localStorage.getItem('remora.tocWidth')).toBe('240');
  });
});

describe('Viewer', () => {
  test('prompts to select a project when none is active', async () => {
    useStore.getState().init(config, null);
    await render(createElement(Viewer));
    expect(container.textContent).toContain('Select or add a project');
  });

  test('shows the open-file hint when the project has no tabs', async () => {
    selectProject();
    await render(createElement(Viewer));
    expect(container.textContent).toContain('Open a file from the panel on the right, or press ⌘P');
  });

  test('renders the open file through the active tab', async () => {
    selectProject();
    readFile.mockResolvedValue({ content: 'const a = 1;\n', truncated: false });
    await render(createElement(Viewer));

    await act(async () => {
      useStore.getState().openFile('src/a.ts');
      await flush();
    });

    expect(container.querySelectorAll('.tab').length).toBe(1);
    expect(container.querySelector('.tab')?.textContent).toBe('a.ts');
    expect(readFile).toHaveBeenCalledWith('p1', 'src/a.ts');
    await waitFor(() => expect(container.querySelector('.code-view .shiki')).not.toBeNull());
  });

  test('shows the host error banner and retries by rewatching and reloading', async () => {
    selectProject();
    readFile.mockResolvedValue({ content: 'x\n', truncated: false });
    useStore.setState({ hosts: { devbox: { host: 'devbox', state: 'error', message: 'ssh timed out' } } });
    await render(createElement(Viewer));

    const banner = container.querySelector('.banner.error')!;
    expect(banner.textContent).toContain('devbox disconnected — retrying…');
    expect(banner.textContent).toContain('ssh timed out');

    await click(banner.querySelector('button')!);
    expect(unwatch).toHaveBeenCalledTimes(1);
    expect(watchProject).toHaveBeenCalledWith('p1');
    expect(useStore.getState().reloadSeq).toBe(1);
  });

  test('hides the banner once the host reports connected', async () => {
    selectProject();
    useStore.setState({ hosts: { devbox: { host: 'devbox', state: 'connected', message: null } } });
    await render(createElement(Viewer));
    expect(container.querySelector('.banner')).toBeNull();
  });
});

describe('FileView', () => {
  test('renders markdown with a TOC and toggles between rendered and source', async () => {
    readFile.mockResolvedValue({ content: '# Title\n\n## Section\n\nsome text\n', truncated: false });
    await render(createElement(FileView, { project, path: 'docs/a.md' }));

    expect(container.querySelector('.breadcrumb .path')?.textContent).toBe('devbox:/w/bm/docs/a.md');
    await waitFor(() => expect(container.querySelector('.markdown-body h1')?.textContent).toBe('Title'));
    await waitFor(() =>
      expect([...container.querySelectorAll('.toc li')].map((i) => i.textContent)).toEqual(['Title', 'Section']),
    );

    await click(button('Source'));
    await waitFor(() => expect(container.querySelector('.code-view')).not.toBeNull());
    expect(container.querySelector('.markdown-body')).toBeNull();
    expect(container.querySelector('.toc')).toBeNull();

    await click(button('Rendered'));
    await waitFor(() => expect(container.querySelector('.markdown-body')).not.toBeNull());
    expect(container.querySelector('.code-view')).toBeNull();
  });

  test('the toolbar contents button hides and reopens the TOC', async () => {
    readFile.mockResolvedValue({ content: '# Title\n\n## Section\n', truncated: false });
    await render(createElement(FileView, { project, path: 'docs/a.md' }));
    await waitFor(() => expect(container.querySelectorAll('.toc li').length).toBe(2));

    await click(button('Contents'));
    expect(container.querySelector('.toc')).toBeNull();
    expect(button('Contents').getAttribute('aria-pressed')).toBe('false');
    await click(button('Contents'));
    expect(container.querySelectorAll('.toc li').length).toBe(2);
  });

  test('copies the host-qualified path, trimming a trailing slash on the project root', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    readFile.mockResolvedValue({ content: 'x\n', truncated: false });
    await render(createElement(FileView, { project: { ...project, path: '/w/bm/' }, path: 'a.ts' }));

    expect(container.querySelector('.breadcrumb .path')?.textContent).toBe('devbox:/w/bm/a.ts');
    await click(container.querySelector('.breadcrumb .path')!);
    // The breadcrumb is host-qualified; the copied value is the remote path only.
    expect(writeText).toHaveBeenCalledWith('/w/bm/a.ts');
  });

  test('the copy button copies the file contents', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    readFile.mockResolvedValue({ content: 'const a = 1;\n', truncated: false });
    await render(createElement(FileView, { project, path: 'a.ts' }));

    await click(button('Copy contents'));
    expect(writeText).toHaveBeenCalledWith('const a = 1;\n');
  });

  test('shows binary files and load errors inline', async () => {
    readFile.mockRejectedValue(Object.assign(new Error('cannot decode'), { kind: 'Binary' }));
    await render(createElement(FileView, { project, path: 'blob.bin' }));
    await waitFor(() => expect(container.querySelector('.pad.error')?.textContent).toBe('Binary file — not shown'));

    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    readFile.mockRejectedValue(notFound());
    await render(createElement(FileView, { project, path: 'missing.md' }));
    await waitFor(() => expect(container.querySelector('.pad.error')?.textContent).toBe('Path not found.'));
  });

  test('shows an image file through readImage and reloads it on change', async () => {
    readImage.mockResolvedValue('data:image/png;base64,AAA');
    await render(createElement(FileView, { project, path: 'docs/logo.png' }));

    await waitFor(() => expect(container.querySelector('.image-view img')?.getAttribute('src')).toBe('data:image/png;base64,AAA'));
    expect(readImage).toHaveBeenCalledWith('p1', 'docs/logo.png');
    expect(readFile).not.toHaveBeenCalled();
    expect(container.querySelector('button[aria-label="Source"]')).toBeNull();

    readImage.mockResolvedValue('data:image/png;base64,BBB');
    await apply('p1', [{ path: 'docs/logo.png', isDir: false, removed: false }]);
    await waitFor(() => expect(container.querySelector('.image-view img')?.getAttribute('src')).toBe('data:image/png;base64,BBB'));
  });

  test('shows an image read error inline', async () => {
    readImage.mockRejectedValue(Object.assign(new Error('image larger than 5242880 bytes'), { kind: 'TooLarge' }));
    await render(createElement(FileView, { project, path: 'big.jpg' }));
    await waitFor(() => expect(container.querySelector('.pad.error')?.textContent).toBe('image larger than 5242880 bytes'));
  });

  test('banners a truncated file', async () => {
    readFile.mockResolvedValue({ content: 'x\n', truncated: true });
    await render(createElement(FileView, { project, path: 'a.ts' }));
    await waitFor(() => expect(container.querySelector('.banner.warn')?.textContent).toContain('larger than 2 MB'));
  });

  test('reloads when the open file or its parent directory changes', async () => {
    readFile.mockResolvedValue({ content: 'one\n', truncated: false });
    await render(createElement(FileView, { project, path: 'docs/a.ts' }));
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));

    // A sibling file, and another project's copy of this path, are both irrelevant.
    await apply('p1', [{ path: 'docs/other.ts', isDir: false, removed: false }]);
    await apply('other', [{ path: 'docs/a.ts', isDir: false, removed: false }]);
    expect(readFile).toHaveBeenCalledTimes(1);

    // Polling reports the parent directory's mtime bump rather than the file itself.
    await apply('p1', [{ path: 'docs', isDir: true, removed: false }]);
    expect(readFile).toHaveBeenCalledTimes(2);

    // inotify reports the file itself.
    await apply('p1', [{ path: 'docs/a.ts', isDir: false, removed: false }]);
    expect(readFile).toHaveBeenCalledTimes(3);
  });

  test('reloads when requestReload bumps the sequence', async () => {
    readFile.mockResolvedValue({ content: 'one\n', truncated: false });
    await render(createElement(FileView, { project, path: 'a.ts' }));
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));

    await act(async () => {
      useStore.getState().requestReload();
      await flush();
    });
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  test('a stale in-flight read cannot overwrite a newer one', async () => {
    let resolveFirst: (content: { content: string; truncated: boolean }) => void = () => {};
    readFile.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    readFile.mockResolvedValue({ content: 'two\n', truncated: false });
    await render(createElement(FileView, { project, path: 'a.ts' }));
    expect(container.textContent).toContain('Loading…');

    // A change lands while the first read is still in flight and wins the race.
    await apply('p1', [{ path: 'a.ts', isDir: false, removed: false }]);
    await waitFor(() => expect(container.textContent).toContain('two'));

    await act(async () => {
      resolveFirst({ content: 'one\n', truncated: false });
      await flush();
    });
    expect(container.textContent).toContain('two');
    expect(container.textContent).not.toContain('one');
  });

  test('keeps the last good content and warns when the file is removed', async () => {
    readFile.mockResolvedValue({ content: 'keep me\n', truncated: false });
    await render(createElement(FileView, { project, path: 'zz.md' }));
    await waitFor(() => expect(container.querySelector('.markdown-body')?.textContent).toContain('keep me'));

    readFile.mockRejectedValue(notFound());
    await apply('p1', [{ path: 'zz.md', isDir: false, removed: true }]);
    expect(container.querySelector('.banner.warn')?.textContent).toContain('File removed');
    expect(container.textContent).toContain('keep me');
  });

  test('a reload error keeps content in place and clears after a successful reload', async () => {
    readFile.mockResolvedValue({ content: 'keep me\n', truncated: false });
    await render(createElement(FileView, { project, path: 'a.ts' }));
    await waitFor(() => expect(container.querySelector('.code-view')).not.toBeNull());

    readFile.mockRejectedValue(Object.assign(new Error('ssh dropped'), { kind: 'Ssh' }));
    await apply('p1', [{ path: 'a.ts', isDir: false, removed: false }]);
    expect(container.querySelector('.banner.error')?.textContent).toContain('ssh dropped');
    expect(container.querySelector('.code-view')).not.toBeNull();

    readFile.mockResolvedValue({ content: 'recovered\n', truncated: false });
    await apply('p1', [{ path: 'a.ts', isDir: false, removed: false }]);
    expect(container.querySelector('.banner.error')).toBeNull();
    await waitFor(() => expect(container.textContent).toContain('recovered'));
  });
});

describe('MarkdownView', () => {
  const md = (source: string, onRendered = vi.fn()) => {
    selectProject();
    const scrollRef = createRef<HTMLDivElement>();
    const onTocChange = vi.fn();
    const props = { project, path: 'docs/a.md', source, scrollRef, onRendered, showToc: true, onTocChange };
    return { el: createElement(MarkdownView, props), onRendered, onTocChange };
  };

  test('renders markdown, draws mermaid, loads images and notifies onRendered', async () => {
    readImage.mockImplementation(async (_id: string, rel: string) => {
      if (rel === 'docs/img/ok.png') return 'data:image/png;base64,AAAA';
      throw new Error('missing');
    });
    const { el, onRendered } = md(
      '# Title\n\n![ok](img/ok.png)\n\n![bad](img/bad.png)\n\n```mermaid\nflowchart LR\n  A --> B\n```\n',
    );
    await render(el);

    await waitFor(() => expect(container.querySelector('.markdown-body h1')?.textContent).toBe('Title'));
    expect(container.querySelector('pre.mermaid-block')).not.toBeNull();

    await waitFor(() => expect(container.querySelectorAll('img')[0].getAttribute('src')).toBe('data:image/png;base64,AAAA'));
    await waitFor(() =>
      expect(container.querySelectorAll('img')[1].getAttribute('alt')).toBe('[image not found: img/bad.png]'),
    );
    expect(readImage).toHaveBeenCalledWith('p1', 'docs/img/ok.png');
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    expect(renderMermaid.mock.calls[0][0]).toBe(container.querySelector('.markdown-body'));
    expect(renderMermaid.mock.calls[0][1]).toBe(false);
    expect(onRendered).toHaveBeenCalled();
  });

  test('passes the dark preference to mermaid', async () => {
    dark = true;
    const { el } = md('```mermaid\nflowchart LR\n  A --> B\n```\n');
    await render(el);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    expect(renderMermaid.mock.calls[0][1]).toBe(true);
  });

  test('a forced theme overrides the OS and redraws mermaid when it changes', async () => {
    dark = true;
    const { el } = md('```mermaid\nflowchart LR\n  A --> B\n```\n');
    useStore.setState((s) => ({ config: { ...s.config, settings: { ...DEFAULT_SETTINGS, theme: 'light' } } }));
    await render(el);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    expect(renderMermaid.mock.calls[0][1]).toBe(false);

    await act(async () => {
      useStore.setState((s) => ({ config: { ...s.config, settings: { ...DEFAULT_SETTINGS, theme: 'dark' } } }));
      await flush();
    });
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(2));
    expect(renderMermaid.mock.calls[1][1]).toBe(true);
  });

  test('routes relative links to openFile with the hash, and external links to the system browser', async () => {
    const { el } = md('# Title\n\n## Section\n\n[rel](../PRD.md#section)\n\n[ext](https://x.dev)\n\n[anchor](#section)\n');
    await render(el);
    await waitFor(() => expect(container.querySelectorAll('.markdown-body a').length).toBe(3));
    expect(scrollIntoView).not.toHaveBeenCalled();

    const link = (i: number) => container.querySelectorAll<HTMLAnchorElement>('.markdown-body a')[i];
    await click(link(0));
    expect(useStore.getState().views.p1.active).toBe('PRD.md');
    // The hash is applied to the rendered body and consumed, so a later render does not re-jump.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useStore.getState().pendingHash).toBeNull());

    await click(link(1));
    expect(openUrl).toHaveBeenCalledWith('https://x.dev');
    expect(useStore.getState().views.p1.active).toBe('PRD.md');
    expect(useStore.getState().views.p1.tabs).toEqual(['PRD.md']);

    await click(link(2));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  test('a link that climbs above the project root is ignored', async () => {
    const { el } = md('[out](../../../etc/passwd)\n');
    await render(el);
    await waitFor(() => expect(container.querySelector('.markdown-body a')).not.toBeNull());

    await click(container.querySelector('.markdown-body a')!);
    expect(useStore.getState().views.p1?.active ?? null).toBeNull();
    expect(openUrl).not.toHaveBeenCalled();
  });

  test('scrolls to a pending hash after rendering and consumes it', async () => {
    useStore.setState({ pendingHash: 'section' });
    const { el, onRendered } = md('# Title\n\n## Section\n');
    await render(el);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(useStore.getState().pendingHash).toBeNull();
    // The hash jump wins over restoring the previous scroll position.
    expect(onRendered).not.toHaveBeenCalled();
  });

  test('table of contents jumps to headings', async () => {
    const { el, onTocChange } = md('# Title\n\n## Section\n');
    await render(el);
    await waitFor(() => expect(container.querySelectorAll('.toc li').length).toBe(2));
    expect(onTocChange).toHaveBeenLastCalledWith(true);

    await click([...container.querySelectorAll('.toc li')][1]);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  test('scroll tracking highlights the heading above the viewport', async () => {
    const scrollRef = createRef<HTMLDivElement>();
    await render(
      createElement(MarkdownView, {
        project,
        path: 'docs/a.md',
        source: '# Title\n\n## Section\n',
        scrollRef,
        onRendered: vi.fn(),
        showToc: true,
        onTocChange: vi.fn(),
      }),
    );
    await waitFor(() => expect(container.querySelectorAll('.toc li').length).toBe(2));

    // jsdom reports offsetTop 0 for every element, so every heading qualifies.
    await act(async () => {
      scrollRef.current!.scrollTop = 0;
      scrollRef.current!.dispatchEvent(new Event('scroll', { bubbles: false }));
      await flush();
    });
    expect(container.querySelector('.toc li.active')?.textContent).toBe('Section');
  });

  test('shows a rendering placeholder before the markdown pipeline resolves', async () => {
    const { el } = md('# Title\n');
    // A synchronous act commits the first paint without waiting for the async pipeline.
    act(() => {
      root.render(el);
    });
    expect(container.textContent).toContain('Rendering…');
    await waitFor(() => expect(container.querySelector('.markdown-body')).not.toBeNull());
  });

  test('a document without headings omits the table of contents', async () => {
    const { el, onTocChange } = md('just a paragraph\n');
    await render(el);
    await waitFor(() => expect(container.querySelector('.markdown-body')).not.toBeNull());
    expect(container.querySelector('.toc')).toBeNull();
    expect(onTocChange).toHaveBeenLastCalledWith(false);
  });
});

describe('CodeView', () => {
  test('highlights the source and notifies onRendered', async () => {
    const onRendered = vi.fn();
    await render(createElement(CodeView, { path: 'src/a.ts', source: 'const a: number = 1;\n', onRendered }));

    await waitFor(() => expect(container.querySelector('.code-view .shiki')).not.toBeNull());
    expect(container.querySelectorAll('.code-view .line').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('const a: number = 1;');
    expect(onRendered).toHaveBeenCalled();
  });

  test('falls back to plain text above the highlight limit', async () => {
    const onRendered = vi.fn();
    const source = 'a'.repeat(300_001);
    await render(createElement(CodeView, { path: 'big.txt', source, onRendered }));

    expect(container.querySelector('.code-view')).toBeNull();
    expect(container.querySelector('.plain-code')?.textContent).toBe(source);
    expect(onRendered).toHaveBeenCalled();
  });
});
