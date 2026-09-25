import { useCallback, useState } from 'react';
import { ContextMenu, type MenuState } from '../components/ContextMenu';
import { CloseIcon } from '../filepanel/icons';
import { basename } from '../lib/paths';
import { useStore } from '../store';

export function Tabs({ tabs, active, preview }: { tabs: string[]; active: string | null; preview: string | null }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  if (!tabs.length) return null;
  const { activateTab, closeTab, closeTabs, pinTab } = useStore.getState();

  const tabMenu = (e: React.MouseEvent, t: string) => {
    e.preventDefault();
    const isLast = tabs.indexOf(t) === tabs.length - 1;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Close', onSelect: () => closeTab(t) },
        { label: 'Close Others', disabled: tabs.length === 1, onSelect: () => closeTabs('others', t) },
        { label: 'Close to the Right', disabled: isLast, onSelect: () => closeTabs('right', t) },
        { label: 'Close All', onSelect: () => closeTabs('all', t) },
      ],
    });
  };

  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div
          key={t}
          className={'tab' + (t === active ? ' active' : '') + (t === preview ? ' preview' : '')}
          title={t}
          onClick={() => activateTab(t)}
          onDoubleClick={() => pinTab(t)}
          onAuxClick={(e) => e.button === 1 && closeTab(t)}
          onContextMenu={(e) => tabMenu(e, t)}
        >
          <span>{basename(t)}</span>
          <button className="tab-close" title="Close" aria-label="Close" onClick={(e) => { e.stopPropagation(); closeTab(t); }}>
            <CloseIcon />
          </button>
        </div>
      ))}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}
