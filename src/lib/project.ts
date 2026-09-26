import type { Entry, Project } from './types';

/** The `host` value that marks a project as a folder on this machine (mirrors `local_fs::LOCAL_HOST`). */
export const LOCAL_HOST = 'local';

export function isLocal(p: Pick<Project, 'host'>): boolean {
  return p.host === LOCAL_HOST;
}

/** Where a project (or an absolute path inside it) lives: `host:path` for remote, the bare path for local. */
export function location(p: Pick<Project, 'host' | 'path'>, abs: string = p.path): string {
  return isLocal(p) ? abs : `${p.host}:${abs}`;
}

/** Absolute path of `rel` inside the project ("" is the project root). */
export function absPath(p: Pick<Project, 'path'>, rel: string): string {
  const root = p.path.replace(/\/$/, '');
  return rel ? `${root}/${rel}` : root;
}

/** Folders in a listing that could each become a project: directories, minus hidden ones, sorted by name. */
export function subfolderNames(entries: Entry[]): string[] {
  return entries
    .filter((e) => e.kind === 'dir' && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}
