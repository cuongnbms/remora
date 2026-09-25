import { useEffect } from 'react';

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean };
export type MenuState = { x: number; y: number; items: MenuItem[] };

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
      {items.map((item) => (
        <li
          key={item.label}
          className={item.disabled ? 'disabled' : ''}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
