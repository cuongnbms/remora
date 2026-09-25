/**
 * The project folder a Finder drop at `el` goes into, read from the nearest `data-drop-dir`:
 * a folder row carries its own path, a file row its parent's, the tree container `""` (root).
 * `null` means the point is outside the file tree.
 */
export function dropDirAt(el: Element | null): string | null {
  const target = el?.closest<HTMLElement>('[data-drop-dir]');
  return target ? (target.dataset.dropDir ?? null) : null;
}
