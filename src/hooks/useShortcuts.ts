import { useEffect, useRef } from 'react';
import { flatProjects, sidebarView } from '../lib/configOps';
import { useStore } from '../store';

type Handlers = { toggleLeft: () => void; toggleRight: () => void };

export function useShortcuts(handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // VS Code's macOS keys for Go Back / Go Forward.
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Minus') {
        const s = useStore.getState();
        if (e.shiftKey) s.goForward();
        else s.goBack();
        e.preventDefault();
        return;
      }
      if (!e.metaKey) return;
      const s = useStore.getState();
      const active = s.activeProjectId ? s.views[s.activeProjectId]?.active : null;
      let handled = true;
      if (e.code === 'KeyB' && e.altKey) ref.current.toggleRight();
      else if (e.code === 'KeyB') ref.current.toggleLeft();
      else if (e.code === 'KeyP') s.setQuickOpen(true);
      else if (e.code === 'KeyF') s.requestFind('open');
      else if (e.code === 'KeyG') s.requestFind(e.shiftKey ? 'prev' : 'next');
      else if (e.code === 'Comma') s.setSettingsOpen(true);
      else if (e.code === 'KeyW') {
        if (active) s.closeTab(active);
      } else if (e.code === 'KeyR') s.requestReload();
      else if (e.shiftKey && e.code === 'BracketLeft') s.cycleTab(-1);
      else if (e.shiftKey && e.code === 'BracketRight') s.cycleTab(1);
      else if (/^Digit[1-9]$/.test(e.code)) {
        const project = flatProjects(sidebarView(s.config))[Number(e.code.slice(5)) - 1];
        if (project) s.selectProject(project.id);
        else handled = false;
      } else handled = false;
      if (handled) e.preventDefault();
    };
    // Mouse buttons 4 and 5 (reported as 3 and 4) are Back and Forward, as in VS Code and browsers.
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      const s = useStore.getState();
      if (e.button === 3) s.goBack();
      else s.goForward();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);
}
