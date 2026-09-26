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

export function moveProject(c: Config, id: string, toGroupId: string): Config {
  const p = findProject(c, id);
  if (!p) return c;
  return addProject(removeProject(c, id), { groupId: toGroupId }, p);
}

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
