import type { Change } from './types';
import { dirname } from './paths';

export function dirsToRefresh(changes: Change[]): string[] {
  const dirs = new Set<string>();
  for (const c of changes) {
    dirs.add(dirname(c.path));
    if (c.isDir) dirs.add(c.path);
  }
  return [...dirs];
}
