import { expect, test } from 'vitest';
import type { Config } from './types';
import { addGroup, addProject, addProjects, addSubgroup, containers, findProject, flatProjects, moveProject, removeGroup, removeProject, renameGroup, toggleGroup, updateProject } from './configOps';
import { DEFAULT_SETTINGS } from './settings';

const base: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    { id: 'g1', name: 'Mine', collapsed: false, projects: [{ id: 'p1', name: 'a', host: 'devbox', path: '/a' }], subgroups: [] },
    { id: 'g2', name: 'Work', collapsed: false, projects: [], subgroups: [] },
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

test('addProjects adds all into one new group', () => {
  const p3 = { id: 'p3', name: 'c', host: 'devbox', path: '/c' };
  const added = addProjects(base, { newGroup: 'Batch' }, [p2, p3]);
  expect(added.groups).toHaveLength(3);
  expect(added.groups[2].projects).toEqual([p2, p3]);
  expect(addProjects(base, { groupId: 'g2' }, [p2, p3]).groups[1].projects).toEqual([p2, p3]);
  expect(addProjects(base, { groupId: 'g2' }, [])).toEqual(base);
});

test('addGroup appends an empty group, reusing a same-named one', () => {
  const added = addGroup(base, 'Side');
  expect(added.groups).toHaveLength(3);
  expect(added.groups[2]).toMatchObject({ name: 'Side', collapsed: false, projects: [], subgroups: [] });
  expect(addGroup(base, 'Work')).toBe(base);
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

const nested: Config = {
  ...base,
  groups: [
    {
      id: 'g1',
      name: 'Mine',
      collapsed: false,
      projects: [{ id: 'p1', name: 'a', host: 'devbox', path: '/a' }],
      subgroups: [
        { id: 's1', name: 'Api', collapsed: false, projects: [{ id: 'p3', name: 'c', host: 'devbox', path: '/c' }] },
        { id: 's2', name: 'Web', collapsed: false, projects: [] },
      ],
    },
    { id: 'g2', name: 'Work', collapsed: false, projects: [], subgroups: [] },
  ],
};

test('addSubgroup appends an empty subgroup to a group only', () => {
  const next = addSubgroup(base, 'g2', 'Sub');
  expect(next.groups[1].subgroups).toMatchObject([{ name: 'Sub', collapsed: false, projects: [] }]);
  expect(() => addSubgroup(nested, 's1', 'Deep')).toThrow('Group not found');
});

test('flatProjects lists subgroup projects before the group own projects', () => {
  expect(flatProjects(nested).map((p) => p.id)).toEqual(['p3', 'p1']);
  expect(findProject(nested, 'p3')?.name).toBe('c');
});

test('containers lists groups then their subgroups with a path label', () => {
  expect(containers(nested).map((x) => [x.id, x.label])).toEqual([
    ['g1', 'Mine'],
    ['s1', 'Mine / Api'],
    ['s2', 'Mine / Web'],
    ['g2', 'Work'],
  ]);
});

test('project ops reach into subgroups', () => {
  expect(findProject(addProject(nested, { groupId: 's2' }, p2), 'p2')).toEqual(p2);
  expect(addProject(nested, { groupId: 's2' }, p2).groups[0].subgroups[1].projects).toEqual([p2]);
  expect(findProject(updateProject(nested, 'p3', { name: 'z' }), 'p3')?.name).toBe('z');
  expect(flatProjects(removeProject(nested, 'p3')).map((p) => p.id)).toEqual(['p1']);
  const moved = moveProject(nested, 'p1', 's2');
  expect(moved.groups[0].projects).toHaveLength(0);
  expect(moved.groups[0].subgroups[1].projects[0].id).toBe('p1');
  expect(moveProject(nested, 'p3', 'g2').groups[1].projects[0].id).toBe('p3');
});

test('subgroup rename, toggle, remove only when empty', () => {
  expect(renameGroup(nested, 's2', 'W').groups[0].subgroups[1].name).toBe('W');
  expect(toggleGroup(nested, 's1').groups[0].subgroups[0].collapsed).toBe(true);
  expect(toggleGroup(nested, 's1').groups[0].collapsed).toBe(false);
  expect(removeGroup(nested, 's2').groups[0].subgroups.map((s) => s.id)).toEqual(['s1']);
  expect(() => removeGroup(nested, 's1')).toThrow('Group is not empty');
});

test('a group with subgroups is not empty', () => {
  const onlySubgroups = removeProject(removeProject(nested, 'p1'), 'p3');
  expect(() => removeGroup(onlySubgroups, 'g1')).toThrow('Group is not empty');
});
