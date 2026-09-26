import { expect, test } from 'vitest';
import type { Config } from './types';
import { addGroup, addProject, addProjects, addSubgroup, containers, findProject, flatProjects, moveGroup, moveProject, moveSubgroup, removeGroup, removeProject, renameGroup, sidebarView, sortByName, toggleGroup, updateProject } from './configOps';
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

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const pr = (id: string, name: string) => ({ id, name, host: 'devbox', path: `/${id}` });
const ordered: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    {
      id: 'g1',
      name: 'Work',
      collapsed: false,
      projects: [pr('p1', 'zeta'), pr('p2', 'Alpha'), pr('p3', 'item10'), pr('p4', 'item2')],
      subgroups: [
        { id: 's1', name: 'web', collapsed: false, projects: [pr('p5', 'b'), pr('p6', 'a')] },
        { id: 's2', name: 'Api', collapsed: false, projects: [] },
      ],
    },
    { id: 'g2', name: 'home', collapsed: false, projects: [], subgroups: [{ id: 's3', name: 'x', collapsed: false, projects: [] }] },
    { id: 'g3', name: 'Archive', collapsed: false, projects: [], subgroups: [] },
  ],
};

test('moveProject inserts before a sibling, or at the end, in any container', () => {
  expect(ids(moveProject(ordered, 'p4', 'g1', 'p1').groups[0].projects)).toEqual(['p4', 'p1', 'p2', 'p3']);
  expect(ids(moveProject(ordered, 'p1', 'g1', null).groups[0].projects)).toEqual(['p2', 'p3', 'p4', 'p1']);
  expect(ids(moveProject(ordered, 'p1', 'g1', 'p3').groups[0].projects)).toEqual(['p2', 'p1', 'p3', 'p4']);
  const across = moveProject(ordered, 'p2', 's1', 'p6');
  expect(ids(across.groups[0].projects)).toEqual(['p1', 'p3', 'p4']);
  expect(ids(across.groups[0].subgroups[0].projects)).toEqual(['p5', 'p2', 'p6']);
  expect(ids(moveProject(ordered, 'p5', 's3').groups[1].subgroups[0].projects)).toEqual(['p5']);
  expect(moveProject(ordered, 'nope', 'g1', null)).toBe(ordered);
  expect(() => moveProject(ordered, 'p1', 'nope')).toThrow();
});

test('moveGroup reorders top-level groups', () => {
  expect(ids(moveGroup(ordered, 'g3', 'g1').groups)).toEqual(['g3', 'g1', 'g2']);
  expect(ids(moveGroup(ordered, 'g1', null).groups)).toEqual(['g2', 'g3', 'g1']);
  expect(ids(moveGroup(ordered, 'g1', 'g3').groups)).toEqual(['g2', 'g1', 'g3']);
  expect(moveGroup(ordered, 'nope', null)).toBe(ordered);
});

test('moveSubgroup reorders within a group and moves to another group with its projects', () => {
  expect(ids(moveSubgroup(ordered, 's2', 'g1', 's1').groups[0].subgroups)).toEqual(['s2', 's1']);
  const across = moveSubgroup(ordered, 's1', 'g2', 's3');
  expect(ids(across.groups[0].subgroups)).toEqual(['s2']);
  expect(ids(across.groups[1].subgroups)).toEqual(['s1', 's3']);
  expect(ids(across.groups[1].subgroups[0].projects)).toEqual(['p5', 'p6']);
  expect(ids(moveSubgroup(ordered, 's3', 'g3', null).groups[2].subgroups)).toEqual(['s3']);
  expect(moveSubgroup(ordered, 'nope', 'g1', null)).toBe(ordered);
  expect(moveSubgroup(ordered, 's1', 'nope', null)).toBe(ordered);
  expect(moveSubgroup(ordered, 's1', 's2', null)).toBe(ordered);
});

test('sortByName sorts groups, subgroups and projects case-insensitively with numeric runs', () => {
  const sorted = sortByName(ordered);
  expect(ids(sorted.groups)).toEqual(['g3', 'g2', 'g1']);
  expect(ids(sorted.groups[2].subgroups)).toEqual(['s2', 's1']);
  expect(ids(sorted.groups[2].projects)).toEqual(['p2', 'p4', 'p3', 'p1']);
  expect(ids(sorted.groups[2].subgroups[1].projects)).toEqual(['p6', 'p5']);
  expect(ids(ordered.groups)).toEqual(['g1', 'g2', 'g3']);
});

test('sidebarView follows the projectOrder setting', () => {
  expect(sidebarView(ordered)).toBe(ordered);
  const byName = { ...ordered, settings: { ...ordered.settings, projectOrder: 'name' as const } };
  expect(ids(sidebarView(byName).groups)).toEqual(['g3', 'g2', 'g1']);
});
