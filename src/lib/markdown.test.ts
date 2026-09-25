import { describe, expect, test } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  test('GFM tables and task lists', async () => {
    const { html } = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
  });

  test('toc from H1-H4 with ids and plain text', async () => {
    const { html, toc } = await renderMarkdown('# Title\n\n## Runtime **shape**\n\n#### Deep\n\n##### Too deep\n\n## Runtime shape\n');
    expect(toc.map((t) => [t.level, t.text])).toEqual([
      [1, 'Title'],
      [2, 'Runtime shape'],
      [4, 'Deep'],
      [2, 'Runtime shape'],
    ]);
    expect(new Set(toc.map((t) => t.id)).size).toBe(4);
    for (const t of toc) expect(html).toContain(`id="${t.id}"`);
  });

  test('toc ids keep Vietnamese letters', async () => {
    const { toc } = await renderMarkdown('## Kiến trúc tổng quan\n');
    expect(toc[0].id).toBe('kiến-trúc-tổng-quan');
  });

  test('code fences are highlighted by shiki; unknown languages fall back to text', async () => {
    const { html } = await renderMarkdown('```ts\nconst a: number = 1;\n```\n\n```nosuchlang\nplain\n```\n');
    expect(html).toContain('class="shiki');
    expect(html).toContain('plain');
  });

  test('mermaid fences become placeholders carrying the source', async () => {
    const { html } = await renderMarkdown('```mermaid\nflowchart LR\n  A --> B\n```\n');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.querySelector<HTMLElement>('pre.mermaid-block');
    expect(el?.dataset.mermaid).toBe('flowchart LR\n  A --> B\n');
  });

  test('relative images are deferred, external ones kept', async () => {
    const { html } = await renderMarkdown('![a](img/a.png) ![b](https://x.dev/b.png)');
    expect(html).toContain('data-rel-src="img/a.png"');
    expect(html).toContain('src="https://x.dev/b.png"');
  });

  test('raw script and event handlers are stripped', async () => {
    const { html } = await renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });
});
