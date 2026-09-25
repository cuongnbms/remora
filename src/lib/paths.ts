export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

export function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export function splitHash(href: string): [string, string] {
  const i = href.indexOf('#');
  return i < 0 ? [href, ''] : [href.slice(0, i), href.slice(i + 1)];
}

/** Resolve a link found in `fromFile` to a project-relative path; null if it leaves the root. */
export function resolveRel(fromFile: string, href: string): string | null {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    /* keep raw */
  }
  const start = decoded.startsWith('/') ? [] : dirname(fromFile).split('/').filter(Boolean);
  const parts = [...start];
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

export function isMarkdown(p: string): boolean {
  return ['md', 'markdown', 'mdx'].includes(extname(p));
}

/** Extensions the backend's `read_image` maps to an image MIME type. */
export function isImage(p: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(extname(p));
}

const BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'jsonc', md: 'markdown', markdown: 'markdown', mdx: 'mdx',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', rb: 'ruby', php: 'php',
  sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
  sql: 'sql', html: 'html', css: 'css', scss: 'scss', vue: 'vue', svelte: 'svelte',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', swift: 'swift', tf: 'hcl', hcl: 'hcl',
  proto: 'proto', graphql: 'graphql', xml: 'xml', lua: 'lua', dart: 'dart', env: 'dotenv',
};
const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile', '.env': 'dotenv' };

export function langFromPath(p: string): string {
  const name = basename(p).toLowerCase();
  return BY_NAME[name] ?? BY_EXT[extname(p)] ?? 'text';
}
