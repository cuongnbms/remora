import { expect, test } from 'vitest';
import type { Config } from './types';
import { addProject, findProject, flatProjects, moveProject, removeGroup, removeProject, renameGroup, toggleGroup, updateProject } from './configOps';
import { DEFAULT_SETTINGS } from './settings';

const base: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    { id: 'g1', name: 'Mine', collapsed: false, projects: [{ id: 'p1', name: 'a', host: 'devbox', path: '/a' }] },
    { id: 'g2', name: 'Work', collapsed: false, projects: [] },
  ],
};
const p2 = { id: 'p2', name: 'b', host: 'devbox', path: '/b' };

test('addProject into existing or new group', () => {
  expect(findProject(addProject(base, { groupId: 'g2' }, p2), 'p2')).toEqual(p2);
  const created = addProject(base, { newGroup: 'New' }, p2);
  expect(created.groups).toHaveLength(3);
  expect(created.groups[2].name).toBe('New');
  expect(addProject(base, { newGroup: 'Work' }, p2).groups).toHaveLength(2);
  expect(() => addProject(base, { groupId: 'nope' }, p2)).toThrow();
});

test('update, move, remove project', () => {
  expect(findProject(updateProject(base, 'p1', { name: 'z' }), 'p1')?.name).toBe('z');
  const moved = moveProject(base, 'p1', 'g2');
  expect(moved.groups[0].projects).toHaveLength(0);
  expect(moved.groups[1].projects[0].id).toBe('p1');
  expect(flatProjects(removeProject(base, 'p1'))).toHaveLength(0);
});

test('group rename, toggle, remove only when empty', () => {
  expect(renameGroup(base, 'g2', 'W').groups[1].name).toBe('W');
  expect(toggleGroup(base, 'g1').groups[0].collapsed).toBe(true);
  expect(removeGroup(base, 'g2').groups).toHaveLength(1);
  expect(() => removeGroup(base, 'g1')).toThrow('Group is not empty');
});

test('ops do not mutate input', () => {
  const snapshot = JSON.stringify(base);
  addProject(base, { groupId: 'g2' }, p2);
  moveProject(base, 'p1', 'g2');
  expect(JSON.stringify(base)).toBe(snapshot);
});
