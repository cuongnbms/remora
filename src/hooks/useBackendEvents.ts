import { useEffect } from 'react';
import { api, errorMessage, onFsChanged, onHostStatus } from '../lib/api';
import { useStore } from '../store';

export function useBackendEvents(): void {
  useEffect(() => {
    const fail = (what: string) => (e: unknown) => {
      useStore.getState().setToast(`${what}: ${errorMessage(e)}`);
      return () => {};
    };
    const unlisteners = [
      onFsChanged((p) => useStore.getState().applyChanges(p.projectId, p.changes)).catch(fail('Cannot watch file changes')),
      onHostStatus((s) => useStore.getState().setHost(s)).catch(fail('Cannot watch host status')),
    ];
    api
      .hostStatuses()
      .then((list) => list.forEach((s) => useStore.getState().setHost(s)))
      .catch((e) => useStore.getState().setToast(`Cannot load host statuses: ${errorMessage(e)}`));
    return () => {
      unlisteners.forEach((u) => u.then((off) => off(), () => {}));
    };
  }, []);
}
