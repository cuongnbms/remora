import type { Config, Group, Project } from './types';

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export const flatProjects = (c: Config): Project[] => c.groups.flatMap((g) => g.projects);
export const findProject = (c: Config, id: string): Project | undefined => flatProjects(c).find((p) => p.id === id);

const mapGroups = (c: Config, fn: (g: Group) => Group): Config => ({ ...c, groups: c.groups.map(fn) });

export type GroupTarget = { groupId: string } | { newGroup: string };

export function addProject(c: Config, target: GroupTarget, p: Project): Config {
  if ('groupId' in target) {
    if (!c.groups.some((g) => g.id === target.groupId)) throw new Error('Group not found');
    return mapGroups(c, (g) => (g.id === target.groupId ? { ...g, projects: [...g.projects, p] } : g));
  }
  const existing = c.groups.find((g) => g.name === target.newGroup);
  if (existing) return addProject(c, { groupId: existing.id }, p);
  return { ...c, groups: [...c.groups, { id: newId(), name: target.newGroup, collapsed: false, projects: [p] }] };
}

export function updateProject(c: Config, id: string, patch: Partial<Omit<Project, 'id'>>): Config {
  return mapGroups(c, (g) => ({ ...g, projects: g.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

export function removeProject(c: Config, id: string): Config {
  return mapGroups(c, (g) => ({ ...g, projects: g.projects.filter((p) => p.id !== id) }));
}

export function moveProject(c: Config, id: string, toGroupId: string): Config {
  const p = findProject(c, id);
  if (!p) return c;
  return addProject(removeProject(c, id), { groupId: toGroupId }, p);
}

export function renameGroup(c: Config, groupId: string, name: string): Config {
  return mapGroups(c, (g) => (g.id === groupId ? { ...g, name } : g));
}

export function toggleGroup(c: Config, groupId: string): Config {
  return mapGroups(c, (g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
}

export function removeGroup(c: Config, groupId: string): Config {
  const g = c.groups.find((x) => x.id === groupId);
  if (g && g.projects.length) throw new Error('Group is not empty');
  return { ...c, groups: c.groups.filter((x) => x.id !== groupId) };
}
