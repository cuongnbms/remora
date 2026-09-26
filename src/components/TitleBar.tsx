import { ArrowLeftIcon, ArrowRightIcon, SearchIcon, SidebarLeftIcon, SidebarRightIcon } from '../filepanel/icons';
import { findProject } from '../lib/configOps';
import { useStore } from '../store';

type Props = {
  leftOpen: boolean;
  rightOpen: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
};

/**
 * Drawn into the native title bar (the window uses an overlay title bar), so every empty spot
 * carries `data-tauri-drag-region` to keep the window draggable.
 */
export function TitleBar({ leftOpen, rightOpen, toggleLeft, toggleRight }: Props) {
  const project = useStore((s) => (s.activeProjectId ? findProject(s.config, s.activeProjectId) : undefined));
  const canBack = useStore((s) => {
    const v = s.activeProjectId ? s.views[s.activeProjectId] : undefined;
    return !!v && v.historyIndex > 0;
  });
  const canForward = useStore((s) => {
    const v = s.activeProjectId ? s.views[s.activeProjectId] : undefined;
    return !!v && v.historyIndex < v.history.length - 1;
  });
  const { goBack, goForward, setQuickOpen } = useStore.getState();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-side" data-tauri-drag-region>
        <span className="titlebar-app" data-tauri-drag-region>
          Remora
        </span>
        <button className={'icon-btn' + (leftOpen ? ' on' : '')} title="Toggle Sidebar (⌘B)" aria-label="Toggle sidebar" onClick={toggleLeft}>
          <SidebarLeftIcon />
        </button>
        <button className="icon-btn" title="Go Back (⌃-)" aria-label="Go back" disabled={!canBack} onClick={goBack}>
          <ArrowLeftIcon />
        </button>
        <button className="icon-btn" title="Go Forward (⌃⇧-)" aria-label="Go forward" disabled={!canForward} onClick={goForward}>
          <ArrowRightIcon />
        </button>
      </div>
      <button className="titlebar-search" title="Go to File (⌘P)" disabled={!project} onClick={() => setQuickOpen(true)}>
        <SearchIcon />
        <span>{project ? project.name : 'Remora'}</span>
      </button>
      <div className="titlebar-side end" data-tauri-drag-region>
        <button className={'icon-btn' + (rightOpen ? ' on' : '')} title="Toggle File Panel (⌥⌘B)" aria-label="Toggle file panel" onClick={toggleRight}>
          <SidebarRightIcon />
        </button>
      </div>
    </header>
  );
}
