import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Config, Group } from './lib/types';

vi.mock('./lib/api', () => ({
  api: { saveConfig: vi.fn(async () => undefined) },
  errorMessage: (e: unknown) =>
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e),
}));

import { api } from './lib/api';
import { useStore } from './store';
import { DEFAULT_SETTINGS } from './lib/settings';

const config: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    {
      id: 'g1',
      name: 'G',
      collapsed: false,
      subgroups: [],
      projects: [
        { id: 'p1', name: 'P1', host: 'h', path: '/x' },
        { id: 'p2', name: 'P2', host: 'h', path: '/y' },
      ],
    },
  ],
};

const reset = () =>
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
    findRequest: null,
    editRequest: null,
  });

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const group = (name: string): Group => ({ id: name, name, collapsed: false, projects: [], subgroups: [] });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(api.saveConfig).mockImplementation(async () => undefined);
  reset();
});

describe('init', () => {
  test('restores only views and active project that still exist', () => {
    localStorage.setItem(
      'remora.ui',
      JSON.stringify({
        activeProjectId: 'gone',
        views: { p1: { tabs: ['a.md'], active: 'a.md' }, gone: { tabs: ['z.md'], active: 'z.md' } },
      }),
    );
    useStore.getState().init(config, 'warning');

    const s = useStore.getState();
    expect(s.ready).toBe(true);
    expect(s.activeProjectId).toBeNull();
    expect(Object.keys(s.views)).toEqual(['p1']);
    expect(s.views.p1).toEqual({ tabs: ['a.md'], active: 'a.md', preview: null, files: null, filesGeneration: 0, history: ['a.md'], historyIndex: 0 });
    expect(s.toast).toBe('warning');
  });

  test('starts empty when the stored snapshot is corrupt', () => {
    localStorage.setItem('remora.ui', '{not json');
    useStore.getState().init(config, null);
    expect(useStore.getState().views).toEqual({});
    expect(useStore.getState().activeProjectId).toBeNull();
  });

  test('persists a snapshot once ready', () => {
    useStore.getState().init(config, null);
    useStore.getState().selectProject('p1');
    useStore.getState().openFile('a.md');

    const stored = JSON.parse(localStorage.getItem('remora.ui') ?? 'null');
    expect(stored).toEqual({ activeProjectId: 'p1', views: { p1: { tabs: ['a.md'], active: 'a.md', preview: 'a.md' } } });
  });

  test('does not persist before ready', () => {
    useStore.getState().setToast('hi');
    expect(localStorage.getItem('remora.ui')).toBeNull();
  });
});

describe('tabs', () => {
  beforeEach(() => {
    useStore.getState().init(config, null);
    useStore.getState().selectProject('p1');
  });

  test('openFile adds once, activates and clears the hash', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', 'section', { pin: true });
    expect(useStore.getState().consumeHash()).toBe('section');
    expect(useStore.getState().consumeHash()).toBeNull();

    s.openFile('a.md');
    expect(useStore.getState().views.p1.tabs).toEqual(['a.md', 'b.md']);
    expect(useStore.getState().views.p1.active).toBe('a.md');
  });

  test('openFile reuses the preview tab in place', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md');
    s.openFile('c.md', undefined, { pin: true });
    useStore.getState().openFile('d.md');
    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['a.md', 'd.md', 'c.md'], active: 'd.md', preview: 'd.md' });
  });

  test('opening an already open file just activates it', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md');
    s.openFile('a.md');
    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['a.md', 'b.md'], active: 'a.md', preview: 'b.md' });
  });

  test('pinTab and pinned opens keep a tab from being replaced', () => {
    const s = useStore.getState();
    s.openFile('a.md');
    useStore.getState().pinTab('a.md');
    useStore.getState().openFile('b.md');
    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['a.md', 'b.md'], preview: 'b.md' });

    useStore.getState().openFile('b.md', undefined, { pin: true });
    useStore.getState().openFile('c.md');
    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['a.md', 'b.md', 'c.md'], preview: 'c.md' });
  });

  test('closing the preview tab clears it', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md');
    useStore.getState().closeTab('b.md');
    expect(useStore.getState().views.p1.preview).toBeNull();

    useStore.getState().openFile('c.md');
    useStore.getState().closeTabs('others', 'a.md');
    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['a.md'], preview: null });
  });

  test('openFile without a hash clears a pending hash', () => {
    const s = useStore.getState();
    s.openFile('a.md', 'section');
    s.openFile('a.md');
    expect(useStore.getState().consumeHash()).toBeNull();
  });

  test('closeTab picks the next tab when the active one closes', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', undefined, { pin: true });
    s.openFile('c.md', undefined, { pin: true });
    useStore.getState().activateTab('b.md');
    useStore.getState().closeTab('b.md');

    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['a.md', 'c.md'], active: 'c.md' });
  });

  test('closeTab keeps the active tab when another closes', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', undefined, { pin: true });
    useStore.getState().activateTab('b.md');
    useStore.getState().closeTab('a.md');

    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['b.md'], active: 'b.md' });
  });

  test('closeTabs closes all, others, or those to the right', () => {
    const open = (active: string) => {
      const s = useStore.getState();
      s.closeTabs('all', 'a.md');
      ['a.md', 'b.md', 'c.md', 'd.md'].forEach((t) => s.openFile(t, undefined, { pin: true }));
      useStore.getState().activateTab(active);
    };
    const view = () => useStore.getState().views.p1;

    open('d.md');
    useStore.getState().closeTabs('right', 'b.md');
    expect(view()).toMatchObject({ tabs: ['a.md', 'b.md'], active: 'b.md' });

    open('a.md');
    useStore.getState().closeTabs('right', 'b.md');
    expect(view()).toMatchObject({ tabs: ['a.md', 'b.md'], active: 'a.md' });

    open('d.md');
    useStore.getState().closeTabs('others', 'c.md');
    expect(view()).toMatchObject({ tabs: ['c.md'], active: 'c.md' });

    open('c.md');
    useStore.getState().closeTabs('all', 'b.md');
    expect(view()).toMatchObject({ tabs: [], active: null });
  });

  test('cycleTab wraps in both directions', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', undefined, { pin: true });
    useStore.getState().activateTab('a.md');

    useStore.getState().cycleTab(-1);
    expect(useStore.getState().views.p1.active).toBe('b.md');
    useStore.getState().cycleTab(1);
    expect(useStore.getState().views.p1.active).toBe('a.md');
  });

  test('cycleTab is a no-op with no tabs', () => {
    useStore.getState().cycleTab(1);
    expect(useStore.getState().views.p1).toEqual({ tabs: [], active: null, preview: null, files: null, filesGeneration: 0, history: [], historyIndex: -1 });
  });

  test('tab actions on no active project do not throw', () => {
    useStore.getState().selectProject(null);
    expect(() => useStore.getState().openFile('a.md')).not.toThrow();
    expect(useStore.getState().views.p1).toBeUndefined();
  });
});

describe('history', () => {
  beforeEach(() => {
    useStore.getState().init(config, null);
    useStore.getState().selectProject('p1');
  });
  const view = () => useStore.getState().views.p1;

  test('records each file that becomes active, once per visit', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', undefined, { pin: true });
    s.activateTab('b.md');
    s.cycleTab(1);
    expect(view()).toMatchObject({ history: ['a.md', 'b.md', 'a.md'], historyIndex: 2 });
  });

  test('goBack and goForward move through history without recording', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', undefined, { pin: true });
    s.openFile('c.md', undefined, { pin: true });

    useStore.getState().goBack();
    useStore.getState().goBack();
    expect(view()).toMatchObject({ active: 'a.md', historyIndex: 0 });
    useStore.getState().goBack();
    expect(view()).toMatchObject({ active: 'a.md', historyIndex: 0 });

    useStore.getState().goForward();
    expect(view()).toMatchObject({ active: 'b.md', historyIndex: 1, history: ['a.md', 'b.md', 'c.md'] });
  });

  test('opening a file after going back drops the forward entries', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', undefined, { pin: true });
    useStore.getState().goBack();
    useStore.getState().openFile('c.md', undefined, { pin: true });
    expect(view()).toMatchObject({ history: ['a.md', 'c.md'], historyIndex: 1 });
    useStore.getState().goForward();
    expect(view().active).toBe('c.md');
  });

  test('going back to a closed file reopens its tab', () => {
    const s = useStore.getState();
    s.openFile('a.md', undefined, { pin: true });
    s.openFile('b.md', undefined, { pin: true });
    useStore.getState().closeTab('a.md');
    useStore.getState().goBack();
    expect(view()).toMatchObject({ active: 'a.md', tabs: ['b.md', 'a.md'] });
  });

  test('keeps at most 50 entries', () => {
    for (let i = 0; i < 60; i++) useStore.getState().openFile(`f${i}.md`);
    expect(view().history).toHaveLength(50);
    expect(view().history[0]).toBe('f10.md');
    expect(view().historyIndex).toBe(49);
  });

  test('history is per project', () => {
    useStore.getState().openFile('a.md');
    useStore.getState().selectProject('p2');
    useStore.getState().goBack();
    expect(useStore.getState().views.p1.history).toEqual(['a.md']);
    expect(useStore.getState().views.p2).toBeUndefined();
  });
});

describe('applyChanges', () => {
  beforeEach(() => {
    useStore.getState().init(config, null);
    useStore.getState().selectProject('p1');
  });

  test('publishes each change batch with an increasing sequence', () => {
    useStore.getState().applyChanges('p1', [{ path: 'a.md', isDir: false, removed: false }]);
    expect(useStore.getState().lastBatch).toMatchObject({ projectId: 'p1', seq: 1 });

    useStore.getState().applyChanges('p1', []);
    expect(useStore.getState().lastBatch?.seq).toBe(2);
  });

  test('keeps a known file list but invalidates it on an unknown, removed or dir path', () => {
    useStore.getState().setFiles('p1', ['a.md', 'b.md']);
    useStore.getState().applyChanges('p1', [{ path: 'a.md', isDir: false, removed: false }]);
    expect(useStore.getState().views.p1.files).toEqual(['a.md', 'b.md']);

    useStore.getState().setFiles('p1', ['a.md', 'b.md']);
    useStore.getState().applyChanges('p1', [{ path: 'new.md', isDir: false, removed: false }]);
    expect(useStore.getState().views.p1.files).toBeNull();

    useStore.getState().setFiles('p1', ['a.md', 'b.md']);
    useStore.getState().applyChanges('p1', [{ path: 'b.md', isDir: false, removed: true }]);
    expect(useStore.getState().views.p1.files).toBeNull();
  });
});

describe('excluded names', () => {
  test('changing them drops every cached file list, other settings do not', async () => {
    useStore.getState().init(config, null);
    useStore.getState().setFiles('p1', ['a.md']);
    useStore.getState().setFiles('p2', ['b.md']);

    await useStore.getState().updateSettings({ theme: 'dark' });
    expect(useStore.getState().views.p1.files).toEqual(['a.md']);

    await useStore.getState().updateSettings({ excludes: ['out'] });
    expect(useStore.getState().config.settings.excludes).toEqual(['out']);
    expect(useStore.getState().views.p1.files).toBeNull();
    expect(useStore.getState().views.p2.files).toBeNull();
  });

  test('a refused save keeps the file lists', async () => {
    useStore.getState().init(config, null);
    useStore.getState().setFiles('p1', ['a.md']);
    vi.mocked(api.saveConfig).mockRejectedValueOnce(new Error('invalid excluded name'));
    await useStore.getState().updateSettings({ excludes: ['a/b'] });
    expect(useStore.getState().config.settings.excludes).toEqual(DEFAULT_SETTINGS.excludes);
    expect(useStore.getState().views.p1.files).toEqual(['a.md']);
  });
});

describe('misc state', () => {
  test('setHost, requestReload and requestEditProject update state', () => {
    const s = useStore.getState();
    s.setHost({ host: 'h', state: 'connected', message: null });
    expect(useStore.getState().hosts.h).toEqual({ host: 'h', state: 'connected', message: null });

    s.requestReload();
    expect(useStore.getState().reloadSeq).toBe(1);

    s.requestEditProject('p1');
    expect(useStore.getState().editRequest).toBe('p1');
  });

  test('setHost bumps reloadSeq only when a host recovers from an error', () => {
    const s = useStore.getState();
    s.setHost({ host: 'h', state: 'connected', message: null });
    expect(useStore.getState().reloadSeq).toBe(0);
    s.setHost({ host: 'h', state: 'error', message: 'down' });
    expect(useStore.getState().reloadSeq).toBe(0);
    s.setHost({ host: 'h', state: 'connected', message: null });
    expect(useStore.getState().reloadSeq).toBe(1);
    s.setHost({ host: 'h', state: 'connected', message: null });
    expect(useStore.getState().reloadSeq).toBe(1);
  });

  test('updateConfig saves the new config', async () => {
    useStore.getState().init(config, null);
    await useStore.getState().updateConfig((c) => ({ ...c, version: 2 }));

    expect(useStore.getState().config.version).toBe(2);
    expect(vi.mocked(api.saveConfig)).toHaveBeenCalledWith({ ...config, version: 2 });
  });

  test('updateSettings merges the patch into the saved settings', async () => {
    useStore.getState().init(config, null);
    await useStore.getState().updateSettings({ theme: 'dark', codeFont: 'Menlo' });

    const expected = { ...DEFAULT_SETTINGS, theme: 'dark', codeFont: 'Menlo' };
    expect(useStore.getState().config.settings).toEqual(expected);
    expect(vi.mocked(api.saveConfig)).toHaveBeenCalledWith({ ...config, settings: expected });
  });

  test('setSettingsOpen toggles the settings dialog', () => {
    useStore.getState().setSettingsOpen(true);
    expect(useStore.getState().settingsOpen).toBe(true);
  });

  test('updateConfig keeps the old config and toasts when the mutator throws', async () => {
    useStore.getState().init(config, null);
    await useStore.getState().updateConfig(() => {
      throw new Error('Group is not empty');
    });

    expect(useStore.getState().config).toEqual(config);
    expect(useStore.getState().toast).toBe('Group is not empty');
  });

  test('updateConfig does not commit the new config until the save succeeds', async () => {
    useStore.getState().init(config, null);
    let resolveSave: () => void = () => {};
    vi.mocked(api.saveConfig).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const pending = useStore.getState().updateConfig((c) => ({ ...c, version: 2 }));

    await flush();
    expect(vi.mocked(api.saveConfig)).toHaveBeenCalledTimes(1);
    expect(useStore.getState().config.version).toBe(1);
    resolveSave();
    await pending;
    expect(useStore.getState().config.version).toBe(2);
  });

  test('updateConfig keeps the old config and toasts when saving fails', async () => {
    useStore.getState().init(config, null);
    vi.mocked(api.saveConfig).mockRejectedValueOnce(new Error('disk full'));
    await useStore.getState().updateConfig((c) => ({ ...c, version: 2 }));

    expect(useStore.getState().config).toEqual(config);
    expect(useStore.getState().config.version).toBe(1);
    expect(useStore.getState().toast).toBe('Cannot save config: disk full');
  });

  test('overlapping updateConfig calls are serialized so both edits persist', async () => {
    useStore.getState().init(config, null);
    const saved: Config[] = [];
    const resolvers: Array<() => void> = [];
    vi.mocked(api.saveConfig).mockImplementation(
      (c) =>
        new Promise<void>((resolve) => {
          saved.push(c);
          resolvers.push(resolve);
        }),
    );

    const first = useStore.getState().updateConfig((c) => ({ ...c, groups: [...c.groups, group('A')] }));
    const second = useStore.getState().updateConfig((c) => ({ ...c, groups: [...c.groups, group('B')] }));

    // The second edit must not start while the first save is still in flight.
    await flush();
    expect(saved.map((c) => c.groups.map((g) => g.name))).toEqual([['G', 'A']]);

    // Once the first save commits, the second edit is applied to that committed config.
    resolvers[0]();
    await flush();
    expect(saved.map((c) => c.groups.map((g) => g.name))).toEqual([
      ['G', 'A'],
      ['G', 'A', 'B'],
    ]);

    resolvers[1]();
    await Promise.all([first, second]);

    expect(useStore.getState().config.groups.map((g) => g.name)).toEqual(['G', 'A', 'B']);
    expect(useStore.getState().toast).toBeNull();
  });
});
