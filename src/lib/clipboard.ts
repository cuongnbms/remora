import { errorMessage } from './api';
import { useStore } from '../store';

/** Copies `text` and confirms with a toast naming `what` was copied. */
export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    useStore.getState().setToast(`Copied ${what}`);
  } catch (e) {
    useStore.getState().setToast(`Cannot copy ${what}: ${errorMessage(e)}`);
  }
}
