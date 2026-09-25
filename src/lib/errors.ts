import type { AppErrorKind } from './types';

/** Failures that mean the host is unreachable, as opposed to a problem with one path. */
export const isConnectionError = (kind: AppErrorKind | null): boolean => kind === 'Ssh' || kind === 'Timeout';

/** Headline for a file that could not be shown; the raw message goes underneath as detail. */
export function fileErrorTitle(kind: AppErrorKind | null, host: string): string {
  switch (kind) {
    case 'Binary':
      return 'Binary file — not shown';
    case 'NotFound':
      return 'File not found';
    case 'TooLarge':
      return 'File is too large to show';
    case 'Ssh':
    case 'Timeout':
      return `Can’t reach ${host}`;
    default:
      return 'Can’t open this file';
  }
}
