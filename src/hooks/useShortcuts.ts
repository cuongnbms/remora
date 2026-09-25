import { useEffect, useRef } from 'react';
import { flatProjects } from '../lib/configOps';
import { useStore } from '../store';

type Handlers = { toggleLeft: () => void; toggleRight: () => void };

export function useShortcuts(handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const s = useStore.getState();
      const active = s.activeProjectId ? s.views[s.activeProjectId]?.active : null;
      let handled = true;
      if (e.code === 'KeyB' && e.altKey) ref.current.toggleRight();
      else if (e.code === 'KeyB') ref.current.toggleLeft();
      else if (e.code === 'KeyP') s.setQuickOpen(true);
      else if (e.code === 'Comma') s.setSettingsOpen(true);
      else if (e.code === 'KeyW') {
        if (active) s.closeTab(active);
      } else if (e.code === 'KeyR') s.requestReload();
      else if (e.shiftKey && e.code === 'BracketLeft') s.cycleTab(-1);
      else if (e.shiftKey && e.code === 'BracketRight') s.cycleTab(1);
      else if (/^Digit[1-9]$/.test(e.code)) {
        const project = flatProjects(s.config)[Number(e.code.slice(5)) - 1];
        if (project) s.selectProject(project.id);
        else handled = false;
      } else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
