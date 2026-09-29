import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean };
// 'separator' draws a divider line between groups of items.
export type MenuState = { x: number; y: number; items: (MenuItem | 'separator')[] };

const EDGE = 4;

/** Keeps a menu of `size` opened at (x, y) inside the viewport: opens upward or leftward when it would overflow. */
export function fitMenu(x: number, y: number, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const place = (at: number, len: number, room: number) =>
    at + len <= room - EDGE ? at : Math.max(EDGE, Math.min(at - len, room - EDGE - len));
  return { left: place(x, size.width, viewport.width), top: place(y, size.height, viewport.height) };
}

export function ContextMenu({ x, y, items, onClose }: MenuState & { onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const { width, height } = ref.current!.getBoundingClientRect();
    setPos(fitMenu(x, y, { width, height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [x, y, items]);
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
    <ul ref={ref} className="context-menu" style={pos} onClick={(e) => e.stopPropagation()}>
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
