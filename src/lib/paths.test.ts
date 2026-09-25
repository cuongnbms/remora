import { describe, expect, test } from 'vitest';
import { basename, dirname, extname, isExternal, isImage, isMarkdown, langFromPath, resolveRel, splitHash } from './paths';

describe('paths', () => {
  test('dirname/basename/extname', () => {
    expect(dirname('docs/adr/a.md')).toBe('docs/adr');
    expect(dirname('a.md')).toBe('');
    expect(basename('docs/a.md')).toBe('a.md');
    expect(extname('docs/A.MD')).toBe('md');
    expect(extname('.gitignore')).toBe('');
    expect(extname('Makefile')).toBe('');
  });

  test('isExternal', () => {
    expect(isExternal('https://x.dev')).toBe(true);
    expect(isExternal('mailto:a@b.c')).toBe(true);
    expect(isExternal('data:image/png;base64,xx')).toBe(true);
    expect(isExternal('./a.md')).toBe(false);
    expect(isExternal('#anchor')).toBe(false);
  });

  test('splitHash', () => {
    expect(splitHash('a.md#sec-1')).toEqual(['a.md', 'sec-1']);
    expect(splitHash('a.md')).toEqual(['a.md', '']);
  });

  test('resolveRel resolves against the file directory and stays inside the root', () => {
    expect(resolveRel('docs/adr/0001.md', '../PRD.md')).toBe('docs/PRD.md');
    expect(resolveRel('docs/a.md', './img/x.png')).toBe('docs/img/x.png');
    expect(resolveRel('docs/a.md', 'b%20c.md')).toBe('docs/b c.md');
    expect(resolveRel('docs/a.md', '/README.md')).toBe('README.md');
    expect(resolveRel('a.md', '../../etc/passwd')).toBeNull();
  });

  test('isMarkdown and langFromPath', () => {
    expect(isMarkdown('x/README.md')).toBe(true);
    expect(isMarkdown('x/a.mdx')).toBe(true);
    expect(isMarkdown('a.ts')).toBe(false);
    expect(isImage('docs/Logo.PNG')).toBe(true);
    expect(isImage('a.svg')).toBe(true);
    expect(isImage('a.md')).toBe(false);
    expect(langFromPath('src/a.tsx')).toBe('tsx');
    expect(langFromPath('Dockerfile')).toBe('dockerfile');
    expect(langFromPath('infra/main.tf')).toBe('hcl');
    expect(langFromPath('weird.xyz')).toBe('text');
  });
});
