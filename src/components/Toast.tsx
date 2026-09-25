import { useEffect } from 'react';
import { useStore, type ToastData } from '../store';

export function Toast() {
  const toast = useStore((s) => s.toast);
  const data: ToastData | null = typeof toast === 'string' ? (toast ? { text: toast } : null) : toast;
  const sticky = !!data?.sticky;
  useEffect(() => {
    if (!toast || sticky) return;
    const t = setTimeout(() => useStore.getState().setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast, sticky]);
  if (!data) return null;
  const { action } = data;
  return (
    <div className="toast" onClick={() => useStore.getState().setToast(null)}>
      <span>{data.text}</span>
      {action && (
        <button
          className="toast-action"
          onClick={(e) => {
            e.stopPropagation();
            action.run();
            useStore.getState().setToast(null);
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
