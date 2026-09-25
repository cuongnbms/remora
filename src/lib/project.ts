import type { Project } from './types';

/** The `host` value that marks a project as a folder on this machine (mirrors `local_fs::LOCAL_HOST`). */
export const LOCAL_HOST = 'local';

export function isLocal(p: Pick<Project, 'host'>): boolean {
  return p.host === LOCAL_HOST;
}

/** Where a project (or an absolute path inside it) lives: `host:path` for remote, the bare path for local. */
export function location(p: Pick<Project, 'host' | 'path'>, abs: string = p.path): string {
  return isLocal(p) ? abs : `${p.host}:${abs}`;
}
