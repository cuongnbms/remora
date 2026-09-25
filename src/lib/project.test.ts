import { describe, expect, test } from 'vitest';
import { LOCAL_HOST, absPath, isLocal, location } from './project';

const remote = { id: 'r', name: 'r', host: 'devbox', path: '/home/me/repo' };
const local = { id: 'l', name: 'l', host: LOCAL_HOST, path: '/Users/me/notes' };

describe('project', () => {
  test('isLocal', () => {
    expect(LOCAL_HOST).toBe('local');
    expect(isLocal(local)).toBe(true);
    expect(isLocal(remote)).toBe(false);
  });

  test('location shows host only for remote projects', () => {
    expect(location(remote)).toBe('devbox:/home/me/repo');
    expect(location(local)).toBe('/Users/me/notes');
    expect(location(remote, '/home/me/repo/a.md')).toBe('devbox:/home/me/repo/a.md');
    expect(location(local, '/Users/me/notes/a.md')).toBe('/Users/me/notes/a.md');
  });

  test('absPath joins the project root and a relative path', () => {
    expect(absPath(remote, 'docs/a.md')).toBe('/home/me/repo/docs/a.md');
    expect(absPath({ ...remote, path: '/home/me/repo/' }, 'a.md')).toBe('/home/me/repo/a.md');
    expect(absPath(remote, '')).toBe('/home/me/repo');
  });
});
