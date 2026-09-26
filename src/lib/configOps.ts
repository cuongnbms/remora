import type { Config, Group, Project, Subgroup } from './types';

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// Sidebar order: a group's subgroups come before its own projects.
export const flatProjects = (c: Config): Project[] =>
  c.groups.flatMap((g) => [...g.subgroups.flatMap((s) => s.projects), ...g.projects]);
export const findProject = (c: Config, id: string): Project | undefined => flatProjects(c).find((p) => p.id === id);

/** Every place a project can live (groups and subgroups), with a "Group / Subgroup" label. */
export const containers = (c: Config): { id: string; label: string; container: Subgroup }[] =>
  c.groups.flatMap((g) => [
    { id: g.id, label: g.name, container: g },
    ...g.subgroups.map((s) => ({ id: s.id, label: `${g.name} / ${s.name}`, container: s })),
  ]);
const findContainer = (c: Config, id: string): Subgroup | undefined => containers(c).find((x) => x.id === id)?.container;

// Applies fn to every group and subgroup; a group keeps its (mapped) subgroups.
const mapContainers = (c: Config, fn: (x: Subgroup) => Subgroup): Config => ({
  ...c,
  groups: c.groups.map((g): Group => ({ ...g, ...fn(g), subgroups: g.subgroups.map(fn) })),
});

export type GroupTarget = { groupId: string } | { newGroup: string };

export function addProject(c: Config, target: GroupTarget, p: Project): Config {
  if ('groupId' in target) {
    if (!findContainer(c, target.groupId)) throw new Error('Group not found');
    return mapContainers(c, (x) => (x.id === target.groupId ? { ...x, projects: [...x.projects, p] } : x));
  }
  const existing = c.groups.find((g) => g.name === target.newGroup);
  if (existing) return addProject(c, { groupId: existing.id }, p);
  return { ...c, groups: [...c.groups, { id: newId(), name: target.newGroup, collapsed: false, projects: [p], subgroups: [] }] };
}

/** Adds several projects to one place; with a new group, the first creates it and the rest join it. */
export function addProjects(c: Config, target: GroupTarget, ps: Project[]): Config {
  return ps.reduce((acc, p) => addProject(acc, target, p), c);
}

export function updateProject(c: Config, id: string, patch: Partial<Omit<Project, 'id'>>): Config {
  return mapContainers(c, (x) => ({ ...x, projects: x.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

export function removeProject(c: Config, id: string): Config {
  return mapContainers(c, (x) => ({ ...x, projects: x.projects.filter((p) => p.id !== id) }));
}

/** `item` placed before the entry with id `beforeId`, or at the end when that is null or not in the list. */
function insertBefore<T extends { id: string }>(list: T[], item: T, beforeId: string | null): T[] {
  const i = beforeId === null ? -1 : list.findIndex((x) => x.id === beforeId);
  return i < 0 ? [...list, item] : [...list.slice(0, i), item, ...list.slice(i)];
}

/** Moves a project into a group or subgroup, before `beforeId` there (null: at the end). */
export function moveProject(c: Config, id: string, toGroupId: string, beforeId: string | null = null): Config {
  const p = findProject(c, id);
  if (!p) return c;
  if (!findContainer(c, toGroupId)) throw new Error('Group not found');
  return mapContainers(removeProject(c, id), (x) => (x.id === toGroupId ? { ...x, projects: insertBefore(x.projects, p, beforeId) } : x));
}

/** Moves a top-level group before `beforeId` (null: to the end). */
export function moveGroup(c: Config, id: string, beforeId: string | null): Config {
  const g = c.groups.find((x) => x.id === id);
  if (!g) return c;
  return { ...c, groups: insertBefore(c.groups.filter((x) => x.id !== id), g, beforeId) };
}

/** Moves a subgroup, with its projects, into a top-level group before `beforeId` (null: at the end). */
export function moveSubgroup(c: Config, id: string, toGroupId: string, beforeId: string | null): Config {
  const s = c.groups.flatMap((g) => g.subgroups).find((x) => x.id === id);
  if (!s || !c.groups.some((g) => g.id === toGroupId)) return c;
  return {
    ...c,
    groups: c.groups.map((g) => {
      const rest = g.subgroups.filter((x) => x.id !== id);
      return { ...g, subgroups: g.id === toGroupId ? insertBefore(rest, s, beforeId) : rest };
    }),
  };
}

const byName = <T extends { name: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

/** A copy with groups, subgroups and projects each sorted by name; the stored order is untouched. */
export function sortByName(c: Config): Config {
  const sortIn = <T extends Subgroup>(x: T): T => ({ ...x, projects: byName(x.projects) });
  return { ...c, groups: byName(c.groups).map((g) => ({ ...sortIn(g), subgroups: byName(g.subgroups).map(sortIn) })) };
}

/** The config as the sidebar shows it, per the `projectOrder` setting. */
export const sidebarView = (c: Config): Config => (c.settings.projectOrder === 'name' ? sortByName(c) : c);

/** Appends an empty top-level group; a group with that name already there is left as the only one. */
export function addGroup(c: Config, name: string): Config {
  if (c.groups.some((g) => g.name === name)) return c;
  return { ...c, groups: [...c.groups, { id: newId(), name, collapsed: false, projects: [], subgroups: [] }] };
}

export function addSubgroup(c: Config, groupId: string, name: string): Config {
  if (!c.groups.some((g) => g.id === groupId)) throw new Error('Group not found');
  const sub: Subgroup = { id: newId(), name, collapsed: false, projects: [] };
  return { ...c, groups: c.groups.map((g) => (g.id === groupId ? { ...g, subgroups: [...g.subgroups, sub] } : g)) };
}

/** Renames a group or a subgroup. */
export function renameGroup(c: Config, groupId: string, name: string): Config {
  return mapContainers(c, (x) => (x.id === groupId ? { ...x, name } : x));
}

/** Collapses or expands a group or a subgroup. */
export function toggleGroup(c: Config, groupId: string): Config {
  return mapContainers(c, (x) => (x.id === groupId ? { ...x, collapsed: !x.collapsed } : x));
}

/** Removes an empty group or subgroup; a group holding subgroups is not empty. */
export function removeGroup(c: Config, groupId: string): Config {
  if (findContainer(c, groupId)?.projects.length || c.groups.find((g) => g.id === groupId)?.subgroups.length) {
    throw new Error('Group is not empty');
  }
  return {
    ...c,
    groups: c.groups.filter((g) => g.id !== groupId).map((g) => ({ ...g, subgroups: g.subgroups.filter((s) => s.id !== groupId) })),
  };
}
