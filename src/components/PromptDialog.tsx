import { useState } from 'react';

export type PromptState = { title: string; initial: string; onSubmit: (value: string) => void };

export function PromptDialog({ title, initial, onSubmit, onClose }: PromptState & { onClose: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (!v) return;
          onSubmit(v);
          onClose();
        }}
      >
        <h3>{title}</h3>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
