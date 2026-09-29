import { useEffect } from 'react';
import { api, errorMessage, onOpenFolders } from '../lib/api';
import { useStore } from '../store';

/**
 * Opens folders sent from the command line. The backend queues them until taken, so waiting for the config to be
 * ready loses nothing: one take right away collects any that arrived during launch, then each event takes the rest.
 */
export function useOpenFolders(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const fail = (e: unknown) => useStore.getState().setToast(`Cannot open folder: ${errorMessage(e)}`);
    const take = () => {
      api
        .takePendingOpens()
        .then((paths) => (paths.length ? useStore.getState().openFolders(paths) : undefined))
        .catch(fail);
    };
    const unlisten = onOpenFolders(take).catch((e) => {
      fail(e);
      return () => {};
    });
    take();
    return () => {
      unlisten.then((off) => off(), () => {});
    };
  }, [ready]);
}
