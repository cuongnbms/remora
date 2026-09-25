import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppErrorKind, Change, Config, Entry, FileContent, FontFamily, HostStatus } from './types';

export const api = {
  loadConfig: () => invoke<{ config: Config; warning: string | null }>('load_config'),
  saveConfig: (config: Config) => invoke<void>('save_config', { config }),
  listSshHosts: () => invoke<string[]>('list_ssh_hosts'),
  listFonts: () => invoke<FontFamily[]>('list_fonts'),
  listRemoteDir: (host: string, path: string) => invoke<Entry[]>('list_remote_dir', { host, path }),
  listDir: (projectId: string, rel: string) => invoke<Entry[]>('list_dir', { projectId, rel }),
  readFile: (projectId: string, rel: string) => invoke<FileContent>('read_file', { projectId, rel }),
  readImage: (projectId: string, rel: string) => invoke<string>('read_image', { projectId, rel }),
  listFiles: (projectId: string) => invoke<string[]>('list_files', { projectId }),
  upload: (projectId: string, destRel: string, sources: string[]) =>
    invoke<string[]>('upload', { projectId, destRel, sources }),
  download: (projectId: string, rel: string) => invoke<string>('download', { projectId, rel }),
  watchProject: (projectId: string) => invoke<void>('watch_project', { projectId }),
  unwatch: () => invoke<void>('unwatch'),
  hostStatuses: () => invoke<HostStatus[]>('host_statuses'),
};

export function onFsChanged(cb: (p: { projectId: string; changes: Change[] }) => void): Promise<UnlistenFn> {
  return listen<{ projectId: string; changes: Change[] }>('fs-changed', (e) => cb(e.payload));
}

export function onHostStatus(cb: (s: HostStatus) => void): Promise<UnlistenFn> {
  return listen<HostStatus>('host-status', (e) => cb(e.payload));
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function errorKind(e: unknown): AppErrorKind | null {
  if (e && typeof e === 'object' && 'kind' in e) return (e as { kind: AppErrorKind }).kind;
  return null;
}
