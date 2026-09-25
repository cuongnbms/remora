import { create } from 'zustand';
import { api, errorMessage } from './lib/api';
import { findProject } from './lib/configOps';
import type { Change, Config, HostStatus, Settings } from './lib/types';
import { DEFAULT_SETTINGS } from './lib/settings';

export type ProjectView = {
  tabs: string[];
  active: string | null;
  /** The single unpinned tab that the next opened file replaces in place. */
  preview: string | null;
  files: string[] | null;
  filesGeneration: number;
};
export type ChangeBatch = { projectId: string; changes: Change[]; seq: number };

/** A toast with an optional button; sticky ones stay until replaced (used while a transfer runs). */
export type ToastData = { text: string; action?: { label: string; run: () => void }; sticky?: boolean };

/** Stable empty array for selectors (a fresh [] each render would loop zustand). */
export const EMPTY_LIST: never[] = [];

const emptyView = (): ProjectView => ({ tabs: [], active: null, preview: null, files: null, filesGeneration: 0 });

type UiSnapshot = { activeProjectId: string | null; views: Record<string, { tabs: string[]; active: string | null; preview?: string | null }> };
const UI_KEY = 'remora.ui';

function readUi(): UiSnapshot | null {
  try {
    const raw = localStorage.getItem(UI_KEY);
    return raw ? (JSON.parse(raw) as UiSnapshot) : null;
  } catch {
    return null;
  }
}

type State = {
  ready: boolean;
  config: Config;
  activeProjectId: string | null;
  views: Record<string, ProjectView>;
  hosts: Record<string, HostStatus>;
  lastBatch: ChangeBatch | null;
  pendingHash: string | null;
  toast: string | ToastData | null;
  quickOpen: boolean;
  settingsOpen: boolean;
  reloadSeq: number;
  editRequest: string | null;
  init(config: Config, warning: string | null): void;
  updateConfig(fn: (c: Config) => Config): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  selectProject(id: string | null): void;
  openFile(path: string, hash?: string, opts?: { pin?: boolean }): void;
  pinTab(path: string): void;
  closeTab(path: string): void;
  closeTabs(scope: 'all' | 'others' | 'right', path: string): void;
  activateTab(path: string): void;
  cycleTab(dir: 1 | -1): void;
  applyChanges(projectId: string, changes: Change[]): void;
  setFiles(projectId: string, files: string[] | null, generation?: number): void;
  setHost(status: HostStatus): void;
  setToast(toast: string | ToastData | null): void;
  setQuickOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  requestReload(): void;
  consumeHash(): string | null;
  requestEditProject(id: string | null): void;
};

export const useStore = create<State>((set, get) => {
  const patchView = (projectId: string, fn: (v: ProjectView) => ProjectView) =>
    set((s) => ({ views: { ...s.views, [projectId]: fn(s.views[projectId] ?? emptyView()) } }));
  const patchActive = (fn: (v: ProjectView) => ProjectView) => {
    const pid = get().activeProjectId;
    if (pid) patchView(pid, fn);
  };
  // Config saves are serialized: each queued task runs `fn` against the config the
  // previous task committed, so overlapping edits compose instead of clobbering.
  let queue: Promise<void> = Promise.resolve();

  return {
    ready: false,
    config: { version: 1, groups: [], settings: DEFAULT_SETTINGS },
    activeProjectId: null,
    views: {},
    hosts: {},
    lastBatch: null,
    pendingHash: null,
    toast: null,
    quickOpen: false,
    settingsOpen: false,
    reloadSeq: 0,
    editRequest: null,

    init(config, warning) {
      const ui = readUi();
      const views: Record<string, ProjectView> = {};
      for (const [id, v] of Object.entries(ui?.views ?? {})) {
        if (findProject(config, id)) views[id] = { ...emptyView(), tabs: v.tabs, active: v.active, preview: v.preview && v.tabs.includes(v.preview) ? v.preview : null };
      }
      const active = ui?.activeProjectId && findProject(config, ui.activeProjectId) ? ui.activeProjectId : null;
      set({ ready: true, config, views, activeProjectId: active, toast: warning });
    },

    updateConfig(fn) {
      const task = async () => {
        let next: Config;
        try {
          next = fn(get().config);
        } catch (e) {
          set({ toast: errorMessage(e) });
          return;
        }
        try {
          // Persist first so the frontend never shows a config the backend refused
          // (the backend validates before replacing its in-memory copy).
          await api.saveConfig(next);
        } catch (e) {
          set({ toast: `Cannot save config: ${errorMessage(e)}` });
          return;
        }
        set({ config: next });
      };
      queue = queue.then(task, task);
      return queue;
    },

    async updateSettings(patch) {
      const before = get().config.settings.excludes;
      await get().updateConfig((c) => ({ ...c, settings: { ...c.settings, ...patch } }));
      // Cached Quick Open lists were built with the old excludes; refetch them on next use.
      if (get().config.settings.excludes !== before) {
        for (const id of Object.keys(get().views)) get().setFiles(id, null);
      }
    },

    selectProject(id) {
      set({ activeProjectId: id });
    },

    openFile(path, hash, opts) {
      patchActive((v) => {
        const pin = opts?.pin ?? false;
        let tabs = v.tabs;
        let preview = v.preview;
        if (tabs.includes(path)) {
          if (pin && preview === path) preview = null;
        } else {
          // Like VS Code: an unpinned open replaces the preview tab where it sits.
          const i = !pin && preview ? tabs.indexOf(preview) : -1;
          tabs = i < 0 ? [...tabs, path] : tabs.map((t, j) => (j === i ? path : t));
          if (!pin) preview = path;
        }
        return { ...v, tabs, active: path, preview };
      });
      set({ pendingHash: hash ?? null });
    },

    closeTab(path) {
      patchActive((v) => {
        const i = v.tabs.indexOf(path);
        const tabs = v.tabs.filter((t) => t !== path);
        const active = v.active !== path ? v.active : (tabs[Math.min(i, tabs.length - 1)] ?? null);
        return { ...v, tabs, active, preview: v.preview === path ? null : v.preview };
      });
    },

    closeTabs(scope, path) {
      patchActive((v) => {
        const i = v.tabs.indexOf(path);
        if (i < 0) return v;
        const tabs = scope === 'all' ? [] : scope === 'others' ? [path] : v.tabs.slice(0, i + 1);
        // A closed active tab hands focus to the tab the command was invoked on.
        const active = v.active && tabs.includes(v.active) ? v.active : (tabs.length ? path : null);
        const preview = v.preview && tabs.includes(v.preview) ? v.preview : null;
        return { ...v, tabs, active, preview };
      });
    },

    pinTab(path) {
      patchActive((v) => (v.preview === path ? { ...v, preview: null } : v));
    },

    activateTab(path) {
      patchActive((v) => ({ ...v, active: path }));
    },

    cycleTab(dir) {
      patchActive((v) => {
        if (!v.tabs.length) return v;
        const i = v.active ? v.tabs.indexOf(v.active) : 0;
        const active = v.tabs[(i + dir + v.tabs.length) % v.tabs.length];
        return { ...v, active };
      });
    },

    applyChanges(projectId, changes) {
      patchView(projectId, (v) => {
        const known = v.files ? new Set(v.files) : null;
        const staleFiles = known === null || changes.some((c) => c.removed || c.isDir || !known.has(c.path));
        return {
          ...v,
          files: staleFiles ? null : v.files,
          filesGeneration: staleFiles ? v.filesGeneration + 1 : v.filesGeneration,
        };
      });
      set((s) => ({ lastBatch: { projectId, changes, seq: (s.lastBatch?.seq ?? 0) + 1 } }));
    },

    setFiles(projectId, files, generation) {
      patchView(projectId, (v) => {
        if (generation !== undefined && generation !== v.filesGeneration) return v;
        return {
          ...v,
          files,
          filesGeneration: files === null ? v.filesGeneration + 1 : v.filesGeneration,
        };
      });
    },

    setHost(status) {
      // A host coming back from an error reloads whatever failed to load while it was down.
      const recovered = get().hosts[status.host]?.state === 'error' && status.state === 'connected';
      set((s) => ({ hosts: { ...s.hosts, [status.host]: status }, reloadSeq: recovered ? s.reloadSeq + 1 : s.reloadSeq }));
    },

    setToast(toast) {
      set({ toast });
    },

    setQuickOpen(quickOpen) {
      set({ quickOpen });
    },

    setSettingsOpen(settingsOpen) {
      set({ settingsOpen });
    },

    requestReload() {
      set((s) => ({ reloadSeq: s.reloadSeq + 1 }));
    },

    consumeHash() {
      const hash = get().pendingHash;
      if (hash) set({ pendingHash: null });
      return hash;
    },

    requestEditProject(editRequest) {
      set({ editRequest });
    },
  };
});

useStore.subscribe((s) => {
  if (!s.ready) return;
  const snapshot: UiSnapshot = {
    activeProjectId: s.activeProjectId,
    views: Object.fromEntries(Object.entries(s.views).map(([id, v]) => [id, { tabs: v.tabs, active: v.active, preview: v.preview }])),
  };
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(snapshot));
  } catch {
    /* storage unavailable: UI state is best-effort */
  }
});
