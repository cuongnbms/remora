import { beforeEach, describe, expect, test, vi } from 'vitest';

const { upload, download, revealItemInDir } = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  revealItemInDir: vi.fn(async (_path: string) => undefined),
}));

vi.mock('./api', () => ({
  api: { upload, download },
  errorMessage: (e: unknown) =>
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir }));

import { useStore, type ToastData } from '../store';
import { startDownload, startUpload } from './transfer';

const toast = () => useStore.getState().toast;

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ toast: null });
});

describe('startUpload', () => {
  test('shows a sticky progress toast, then the final names', async () => {
    let resolve!: (names: string[]) => void;
    upload.mockReturnValue(new Promise<string[]>((r) => (resolve = r)));
    const done = startUpload('p1', 'docs', ['/Users/me/a.png', '/Users/me/x/notes.md']);
    expect(upload).toHaveBeenCalledWith('p1', 'docs', ['/Users/me/a.png', '/Users/me/x/notes.md']);
    expect(toast()).toEqual({ text: 'Uploading 2 items to docs/…', sticky: true });
    resolve(['a.png', 'notes (1).md']);
    await done;
    expect(toast()).toBe('Uploaded to docs/: a.png, notes (1).md');
  });

  test('names a single item and shows the root as /', async () => {
    upload.mockResolvedValue(['a.png']);
    const done = startUpload('p1', '', ['/Users/me/a.png']);
    expect(toast()).toEqual({ text: 'Uploading a.png to /…', sticky: true });
    await done;
    expect(toast()).toBe('Uploaded to /: a.png');
  });

  test('reports a failure', async () => {
    upload.mockRejectedValue({ kind: 'Ssh', message: 'Connection refused' });
    await startUpload('p1', 'docs', ['/Users/me/a.png']);
    expect(toast()).toBe('Upload failed: Connection refused');
  });

  test('does nothing for an empty drop', async () => {
    await startUpload('p1', 'docs', []);
    expect(upload).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });
});

describe('startDownload', () => {
  test('shows progress, then the saved name with a Show in Finder action', async () => {
    let resolve!: (path: string) => void;
    download.mockReturnValue(new Promise<string>((r) => (resolve = r)));
    const done = startDownload('p1', 'docs/report.md');
    expect(download).toHaveBeenCalledWith('p1', 'docs/report.md');
    expect(toast()).toEqual({ text: 'Downloading report.md…', sticky: true });
    resolve('/Users/me/Downloads/report (1).md');
    await done;
    const t = toast() as ToastData;
    expect(t.text).toBe('Saved report (1).md');
    expect(t.sticky).toBeFalsy();
    expect(t.action?.label).toBe('Show in Finder');
    t.action!.run();
    expect(revealItemInDir).toHaveBeenCalledWith('/Users/me/Downloads/report (1).md');
  });

  test('reports a failure', async () => {
    download.mockRejectedValue({ kind: 'NotFound', message: 'gone' });
    await startDownload('p1', 'docs/report.md');
    expect(toast()).toBe('Download failed: gone');
  });

  test('shows error toast when reveal fails', async () => {
    download.mockResolvedValue('/Users/me/Downloads/report.md');
    revealItemInDir.mockRejectedValueOnce(new Error('no such file'));
    const done = startDownload('p1', 'docs/report.md');
    await done;
    const t = toast() as ToastData;
    expect(t.text).toBe('Saved report.md');
    expect(t.action?.label).toBe('Show in Finder');
    t.action!.run();
    await new Promise((r) => setTimeout(r, 0));
    expect(toast()).toBe('Cannot show in Finder: no such file');
  });
});
