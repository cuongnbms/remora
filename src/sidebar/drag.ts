import { containers, moveGroup, moveProject, moveSubgroup } from '../lib/configOps';
import type { Config } from '../lib/types';

/** What is being dragged in the sidebar. */
export type DragItem = { kind: 'group' | 'subgroup' | 'project'; id: string };
/**
 * Where the drop line is drawn: before or after a row or section, or `into` a group or subgroup
 * row (the dragged item goes to the end of it). `on` names which element carries the mark.
 */
export type DropHint = { id: string; on: 'row' | 'section'; pos: 'before' | 'after' | 'into' };
export type Drop = { hint: DropHint; apply: (c: Config) => Config };

/** The id right after `id` in `list`, skipping `skip` (the dragged item); null at the end. */
function nextId(list: { id: string }[], id: string, skip: string): string | null {
  const rest = list.filter((x) => x.id !== skip);
  return rest[rest.findIndex((x) => x.id === id) + 1]?.id ?? null;
}

function half(el: Element, y: number): 'before' | 'after' {
  const r = el.getBoundingClientRect();
  return y < r.top + r.height / 2 ? 'before' : 'after';
}

/**
 * The drop for `item` with the pointer over `el` at height `y`, read from the sidebar's data attributes:
 * sections carry `data-group` or `data-subgroup` (+ `data-parent`), rows carry `data-row`, `data-id` and,
 * for projects, `data-container`. Null when nothing sensible is under the pointer, or it is the item itself.
 */
export function resolveDrop(c: Config, item: DragItem, el: Element | null, y: number): Drop | null {
  if (!el) return null;
  if (item.kind === 'group') {
    const sec = el.closest<HTMLElement>('[data-group]');
    const target = sec?.dataset.group;
    if (!sec || !target || target === item.id) return null;
    const pos = half(sec, y);
    const beforeId = pos === 'before' ? target : nextId(c.groups, target, item.id);
    return { hint: { id: target, on: 'section', pos }, apply: (x) => moveGroup(x, item.id, beforeId) };
  }
  if (item.kind === 'subgroup') {
    const sec = el.closest<HTMLElement>('[data-subgroup]');
    const target = sec?.dataset.subgroup;
    const parent = sec?.dataset.parent;
    if (sec && target && parent) {
      if (target === item.id) return null;
      const pos = half(sec, y);
      const siblings = c.groups.find((g) => g.id === parent)?.subgroups ?? [];
      const beforeId = pos === 'before' ? target : nextId(siblings, target, item.id);
      return { hint: { id: target, on: 'section', pos }, apply: (x) => moveSubgroup(x, item.id, parent, beforeId) };
    }
    // Anywhere else in a group (its header or its own projects) appends the subgroup to that group.
    const group = el.closest<HTMLElement>('[data-group]')?.dataset.group;
    if (!group) return null;
    return { hint: { id: group, on: 'row', pos: 'into' }, apply: (x) => moveSubgroup(x, item.id, group, null) };
  }
  const row = el.closest<HTMLElement>('[data-row]');
  const id = row?.dataset.id;
  if (!row || !id) return null;
  if (row.dataset.row !== 'project') {
    return { hint: { id, on: 'row', pos: 'into' }, apply: (x) => moveProject(x, item.id, id, null) };
  }
  const container = row.dataset.container;
  if (id === item.id || !container) return null;
  const pos = half(row, y);
  const siblings = containers(c).find((x) => x.id === container)?.container.projects ?? [];
  const beforeId = pos === 'before' ? id : nextId(siblings, id, item.id);
  return { hint: { id, on: 'row', pos }, apply: (x) => moveProject(x, item.id, container, beforeId) };
}
