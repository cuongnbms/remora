import { describe, expect, test } from 'vitest';
import { dropDirAt } from './dropTarget';

describe('dropDirAt', () => {
  document.body.innerHTML = `
    <div class="tree" data-drop-dir="">
      <div class="section-title"><span id="title">Files</span></div>
      <div class="tree-row dir" data-drop-dir="docs"><span id="dirname">docs</span></div>
      <div class="tree-row file" data-drop-dir="docs"><span id="filename">a.md</span></div>
      <div class="tree-row file" data-drop-dir=""><span id="rootfile">b.md</span></div>
      <div id="empty"></div>
    </div>
    <div id="outside"></div>`;
  const byId = (id: string) => document.getElementById(id);

  test('a folder row targets that folder, a file row its parent', () => {
    expect(dropDirAt(byId('dirname'))).toBe('docs');
    expect(dropDirAt(byId('filename'))).toBe('docs');
    expect(dropDirAt(byId('rootfile'))).toBe('');
  });

  test('empty tree space and the title target the root; outside is null', () => {
    expect(dropDirAt(byId('empty'))).toBe('');
    expect(dropDirAt(byId('title'))).toBe('');
    expect(dropDirAt(byId('outside'))).toBeNull();
    expect(dropDirAt(null)).toBeNull();
  });
});
