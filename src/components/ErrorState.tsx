import type { ReactNode } from 'react';
import { useStore } from '../store';
import { AlertIcon } from '../filepanel/icons';

/**
 * A centered message for a panel whose content failed to load: a headline, the raw error
 * underneath (wrapping and selectable), and an optional action. `quiet` drops the alert styling
 * for states that are expected rather than failures (a binary file, waiting on a reconnect).
 */
export function ErrorState({ title, detail, action, quiet }: { title: string; detail?: string | null; action?: ReactNode; quiet?: boolean }) {
  return (
    <div className={'error-state' + (quiet ? ' quiet' : '')} role="status">
      {!quiet && <AlertIcon />}
      <p className="error-title">{title}</p>
      {detail && <p className="error-detail">{detail}</p>}
      {action}
    </div>
  );
}

/** True while `host` is reported unreachable, i.e. the viewer's connection banner is showing. */
export const useHostDown = (host: string | undefined) =>
  useStore((s) => (host ? s.hosts[host]?.state === 'error' : false));
