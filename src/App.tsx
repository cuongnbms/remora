import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { Toast } from './components/Toast';
import { QuickOpen } from './components/QuickOpen';
import { TitleBar } from './components/TitleBar';
import { FilePanel } from './filepanel/FilePanel';
import { useBackendEvents } from './hooks/useBackendEvents';
import { useShortcuts } from './hooks/useShortcuts';
import { api, errorMessage } from './lib/api';
import { findProject } from './lib/configOps';
import { applySettings, cacheSettings } from './lib/settings';
import { SettingsDialog } from './settings/SettingsDialog';
import { ProjectSidebar } from './sidebar/ProjectSidebar';
import { useStore } from './store';
import { Viewer } from './viewer/Viewer';

export function togglePanel(ref: React.RefObject<ImperativePanelHandle | null>) {
  const panel = ref.current;
  if (!panel) return;
  if (panel.isCollapsed()) panel.expand();
  else panel.collapse();
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const settings = useStore((s) => s.config.settings);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const watchKey = useStore((s) => {
    const p = s.activeProjectId ? findProject(s.config, s.activeProjectId) : undefined;
    // Excluded names never contain '/'; a change restarts the watcher with the new list.
    return p ? `${p.id}|${p.host}|${p.path}|${s.config.settings.excludes.join('/')}` : null;
  });
  const left = useRef<ImperativePanelHandle>(null);
  const right = useRef<ImperativePanelHandle>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const toggleLeft = () => togglePanel(left);
  const toggleRight = () => togglePanel(right);

  useBackendEvents();
  useShortcuts({ toggleLeft, toggleRight });

  useEffect(() => {
    api
      .loadConfig()
      .then(({ config, warning }) => useStore.getState().init(config, warning))
      .catch((e) => {
        const message = `Cannot load config: ${errorMessage(e)}`;
        setLoadError(message);
        useStore.getState().setToast(message);
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    applySettings(settings);
    cacheSettings(settings);
    // Match the native title bar and window chrome; null follows the OS.
    void getCurrentWindow()
      .setTheme(settings.theme === 'system' ? null : settings.theme)
      .catch(() => {});
  }, [ready, settings]);

  useEffect(() => {
    if (!ready) return;
    const id = watchKey?.split('|')[0];
    const call = id ? api.watchProject(id) : api.unwatch();
    call.catch((e) => useStore.getState().setToast(errorMessage(e)));
  }, [ready, watchKey]);

  if (!ready) {
    return (
      <div className="app">
        <div className="titlebar" data-tauri-drag-region />
        <div className="muted pad">{loadError ?? 'Loading…'}</div>
        <Toast />
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar leftOpen={leftOpen} rightOpen={rightOpen} toggleLeft={toggleLeft} toggleRight={toggleRight} />
      <PanelGroup direction="horizontal" autoSaveId="remora-layout">
        <Panel ref={left} order={1} defaultSize={18} minSize={12} collapsible onCollapse={() => setLeftOpen(false)} onExpand={() => setLeftOpen(true)}>
          <ProjectSidebar />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel order={2} minSize={30}>
          <Viewer />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel ref={right} order={3} defaultSize={20} minSize={12} collapsible onCollapse={() => setRightOpen(false)} onExpand={() => setRightOpen(true)}>
          <FilePanel />
        </Panel>
      </PanelGroup>
      <QuickOpen />
      {settingsOpen && <SettingsDialog onClose={() => useStore.getState().setSettingsOpen(false)} />}
      <Toast />
    </div>
  );
}
