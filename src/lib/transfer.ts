import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useStore } from '../store';
import { api, errorMessage } from './api';
import { basename } from './paths';

/** How a project folder reads in messages: the root is `/`, others end with `/`. */
const where = (dir: string) => (dir ? `${dir}/` : '/');

/** Upload Finder paths into the project folder `destRel` ("" is the root), reporting through the toast. */
export async function startUpload(projectId: string, destRel: string, sources: string[]): Promise<void> {
  if (!sources.length) return;
  const { setToast } = useStore.getState();
  const what = sources.length === 1 ? basename(sources[0]) : `${sources.length} items`;
  setToast({ text: `Uploading ${what} to ${where(destRel)}…`, sticky: true });
  try {
    const names = await api.upload(projectId, destRel, sources);
    setToast(`Uploaded to ${where(destRel)}: ${names.join(', ')}`);
  } catch (e) {
    setToast(`Upload failed: ${errorMessage(e)}`);
  }
}

/** Download a project file or folder into ~/Downloads, offering to reveal it in Finder. */
export async function startDownload(projectId: string, rel: string): Promise<void> {
  const { setToast } = useStore.getState();
  setToast({ text: `Downloading ${basename(rel)}…`, sticky: true });
  try {
    const saved = await api.download(projectId, rel);
    setToast({
      text: `Saved ${basename(saved)}`,
      action: {
        label: 'Show in Finder',
        run: () => {
          revealItemInDir(saved).catch((e) => {
            useStore.getState().setToast(`Cannot show in Finder: ${errorMessage(e)}`);
          });
        },
      },
    });
  } catch (e) {
    setToast(`Download failed: ${errorMessage(e)}`);
  }
}
