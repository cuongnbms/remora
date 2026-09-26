import { useEffect, type ReactNode } from 'react';

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean };
// 'separator' draws a divider line between groups of items.
export type MenuState = { x: number; y: number; items: (MenuItem | 'separator')[] };

export function ContextMenu({ x, y, items, onClose }: MenuState & { onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <ul className="context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <li key={`separator-${i}`} className="separator" role="separator" />
        ) : (
          <li
            key={item.label}
            className={item.disabled ? 'disabled' : ''}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            {item.label}
          </li>
        ),
      )}
    </ul>
  );
}
