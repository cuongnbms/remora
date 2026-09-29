import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Config } from '../lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { saveConfig, listSshHosts } = vi.hoisted(() => ({
  saveConfig: vi.fn(async (_c: unknown) => undefined),
  listSshHosts: vi.fn(async () => []),
}));

vi.mock('../lib/api', () => ({
  api: { saveConfig, listSshHosts },
  errorMessage: (e: unknown) => String(e),
}));

import { updateProject } from '../lib/configOps';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { useStore } from '../store';
import { ProjectSidebar } from './ProjectSidebar';

const config: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    {
      id: 'g1',
      name: 'Work',
      collapsed: false,
      projects: [{ id: 'p1', name: 'own', host: 'devbox', path: '/own' }],
      subgroups: [
        { id: 's1', name: 'Api', collapsed: false, projects: [{ id: 'p2', name: 'api', host: 'devbox', path: '/api' }] },
        { id: 's2', name: 'Web', collapsed: true, projects: [{ id: 'p3', name: 'web', host: 'devbox', path: '/web' }] },
      ],
    },
    { id: 'g2', name: 'Home', collapsed: false, projects: [], subgroups: [] },
  ],
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let container: HTMLDivElement;
let root: Root;

const rows = () =>
  [...container.querySelectorAll('.group-row, .project-row')].map((el) =>
    `${el.classList.contains('subgroup') ? 'sub' : el.classList.contains('group-row') ? 'group' : 'project'}:${el.textContent}`,
  );
const row = (text: string) => [...container.querySelectorAll<HTMLElement>('.group-row, .project-row')].find((el) => el.textContent?.startsWith(text))!;
const menuItems = () => [...document.querySelectorAll('.context-menu li')].map((li) => li.textContent);

async function contextMenu(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1, clientY: 1 }));
    await flush();
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  useStore.getState().init(config, null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(ProjectSidebar));
    await flush();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('renders subgroups before the group own projects and hides collapsed subgroup projects', () => {
  expect(rows()).toEqual(['group:Work', 'sub:Api', 'project:apidevbox', 'sub:Web', 'project:owndevbox', 'group:Home']);
});

test('clicking a subgroup toggles only that subgroup', async () => {
  await click(row('Web'));
  expect(useStore.getState().config.groups[0].subgroups[1].collapsed).toBe(false);
  expect(useStore.getState().config.groups[0].collapsed).toBe(false);
});

test('group menu offers New subgroup, subgroup menu does not', async () => {
  await contextMenu(row('Work'));
  expect(menuItems()).toEqual(['Rename…', 'New subgroup…', 'Remove (group not empty)']);
  await contextMenu(row('Api'));
  expect(menuItems()).toEqual(['Rename…', 'Remove (group not empty)']);
});

test('project menu can move into other groups and subgroups', async () => {
  await contextMenu(row('api'));
  expect(menuItems().filter((l) => l?.startsWith('Move to'))).toEqual(['Move to Work', 'Move to Work / Web', 'Move to Home']);
  await click([...document.querySelectorAll('.context-menu li')].find((li) => li.textContent === 'Move to Work / Web')!);
  expect(useStore.getState().config.groups[0].subgroups[1].projects.map((p) => p.id)).toEqual(['p3', 'p2']);
});

test('menu items show an icon before the label', async () => {
  await contextMenu(row('api'));
  const icon = (label: string) =>
    [...document.querySelectorAll('.context-menu li')].find((li) => li.textContent === label)?.querySelector('.menu-icon svg')?.getAttribute('data-icon');
  expect(icon('Rename…')).toBe('pencil');
  expect(icon('Remove')).toBe('trash');
  expect(icon('Move to Home')).toBe('folder-input');
});

const pointer = (type: string, target: EventTarget, x: number, y: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));

/** Drags `from` onto `to`, landing in its top or bottom half; `to` is what elementFromPoint reports. */
async function dragTo(from: HTMLElement, to: HTMLElement, half: 'top' | 'bottom', end: 'drop' | 'escape' = 'drop') {
  vi.spyOn(to, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 20, bottom: 120, left: 0, right: 100, width: 100, x: 0, y: 100, toJSON: () => ({}) });
  const y = half === 'top' ? 102 : 118;
  document.elementFromPoint = vi.fn(() => to);
  await act(async () => {
    pointer('pointerdown', from, 0, 0);
    pointer('pointermove', window, 0, y);
    await flush();
  });
  await act(async () => {
    if (end === 'drop') {
      pointer('pointerup', window, 0, y);
      to.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
  });
}
const groups = () => useStore.getState().config.groups;
const section = (id: string) => container.querySelector<HTMLElement>(`[data-group="${id}"], [data-subgroup="${id}"]`)!;

test('order button switches to sorting by name without changing the stored order', async () => {
  await click(container.querySelector('[aria-label="Project order"]')!);
  expect(menuItems()).toEqual(['Manual order', 'Sort by name']);
  await click([...document.querySelectorAll('.context-menu li')].find((li) => li.textContent === 'Sort by name')!);
  expect(useStore.getState().config.settings.projectOrder).toBe('name');
  expect(saveConfig).toHaveBeenCalled();
  expect(rows()).toEqual(['group:Home', 'group:Work', 'sub:Api', 'project:apidevbox', 'sub:Web', 'project:owndevbox']);
  expect(groups().map((g) => g.id)).toEqual(['g1', 'g2']);
});

test('dragging a project onto the top half of another inserts it before, and the drop click is swallowed', async () => {
  await dragTo(row('own'), row('api'), 'top');
  expect(groups()[0].subgroups[0].projects.map((p) => p.id)).toEqual(['p1', 'p2']);
  expect(groups()[0].projects).toEqual([]);
  expect(useStore.getState().activeProjectId).toBeNull();
});

test('dragging a project onto a group row appends it there', async () => {
  await dragTo(row('api'), row('Home'), 'top');
  expect(groups()[1].projects.map((p) => p.id)).toEqual(['p2']);
  expect(groups()[1].collapsed).toBe(false);
});

test('dragging a group below another reorders groups', async () => {
  await dragTo(row('Work'), section('g2'), 'bottom');
  expect(groups().map((g) => g.id)).toEqual(['g2', 'g1']);
});

test('dragging a subgroup into another group moves it with its projects', async () => {
  await dragTo(row('Api'), row('Home'), 'top');
  expect(groups()[0].subgroups.map((s) => s.id)).toEqual(['s2']);
  expect(groups()[1].subgroups.map((s) => s.id)).toEqual(['s1']);
  expect(groups()[1].subgroups[0].projects.map((p) => p.id)).toEqual(['p2']);
});

test('Escape cancels a drag', async () => {
  await dragTo(row('Work'), section('g2'), 'bottom', 'escape');
  expect(groups().map((g) => g.id)).toEqual(['g1', 'g2']);
  expect(saveConfig).not.toHaveBeenCalled();
});

test('rows do not drag when sorted by name', async () => {
  await act(async () => {
    await useStore.getState().updateSettings({ projectOrder: 'name' });
  });
  saveConfig.mockClear();
  await dragTo(row('Work'), section('g2'), 'bottom');
  expect(saveConfig).not.toHaveBeenCalled();
});

test('host state shows on the badge, with the error on hover, and rows have no leading dot', async () => {
  const badge = () => row('api').querySelector<HTMLElement>('.badge')!;
  expect(container.querySelector('.dot')).toBeNull();
  expect(badge().className).toBe('badge idle');
  await act(async () => {
    useStore.setState({ hosts: { devbox: { host: 'devbox', state: 'connected', message: null } } });
  });
  expect(badge().className).toBe('badge connected');
  expect(badge().querySelector('.badge-dot')).not.toBeNull();
  await act(async () => {
    useStore.setState({ hosts: { devbox: { host: 'devbox', state: 'error', message: 'ssh: timed out' } } });
  });
  expect(badge().className).toBe('badge error');
  expect(badge().title).toBe('ssh: timed out');
  expect(badge().querySelector('svg')?.getAttribute('data-icon')).toBe('alert');
});

test('project rows lead with a folder icon, local or remote', async () => {
  await act(async () => {
    await useStore.getState().updateConfig((c) => updateProject(c, 'p1', { host: 'local' }));
  });
  const icon = (text: string) => row(text).querySelector('.project-icon svg')?.getAttribute('data-icon');
  expect(icon('own')).toBe('folder');
  expect(icon('api')).toBe('folder');
});

const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('.context-menu li')].find((li) => li.textContent === label)!;
const bookmarkRows = () => [...container.querySelectorAll('.bookmarks .project-row')].map((el) => el.textContent);

test('the Bookmarks section is hidden until a project is bookmarked', async () => {
  expect(container.querySelector('.bookmarks')).toBeNull();
  await contextMenu(row('own'));
  expect(menuItem('Bookmark').querySelector('.menu-icon svg')?.getAttribute('data-icon')).toBe('star');
  await click(menuItem('Bookmark'));
  expect(useStore.getState().config.groups[0].projects[0].bookmarked).toBe(true);
  expect(container.querySelector('.bookmarks-label')?.textContent).toBe('Bookmarks');
  expect(container.querySelector('.bookmarks-label [data-icon="star"]')).not.toBeNull();
  expect(bookmarkRows()).toEqual(['owndevbox']);
  // The project stays in its group too.
  expect(rows()).toEqual(['project:owndevbox', 'group:Work', 'sub:Api', 'project:apidevbox', 'sub:Web', 'project:owndevbox', 'group:Home']);
});

test('bookmarks follow sidebar order, including projects of collapsed subgroups', async () => {
  await act(async () => {
    await useStore.getState().updateConfig((c) => updateProject(updateProject(c, 'p1', { bookmarked: true }), 'p3', { bookmarked: true }));
  });
  expect(bookmarkRows()).toEqual(['webdevbox', 'owndevbox']);
});

test('a bookmark row selects its project, highlights with it, and can remove the bookmark', async () => {
  await act(async () => {
    await useStore.getState().updateConfig((c) => updateProject(c, 'p2', { bookmarked: true }));
  });
  const bookmark = container.querySelector<HTMLElement>('.bookmarks .project-row')!;
  await click(bookmark);
  expect(useStore.getState().activeProjectId).toBe('p2');
  expect(container.querySelectorAll('.project-row.active')).toHaveLength(2);
  await contextMenu(bookmark);
  expect(menuItems()).toContain('Remove bookmark');
  expect(menuItems()).not.toContain('Bookmark');
  await click(menuItem('Remove bookmark'));
  expect(useStore.getState().config.groups[0].subgroups[0].projects[0].bookmarked).toBe(false);
  expect(container.querySelector('.bookmarks')).toBeNull();
});

test('bookmark rows do not drag', async () => {
  await act(async () => {
    await useStore.getState().updateConfig((c) => updateProject(c, 'p2', { bookmarked: true }));
  });
  await dragTo(container.querySelector<HTMLElement>('.bookmarks .project-row')!, row('Home'), 'bottom');
  expect(groups()[1].projects).toEqual([]);
  expect(groups()[0].subgroups[0].projects.map((p) => p.id)).toEqual(['p2']);
});

test('clicking the Bookmarks label collapses and expands the section, and it is saved', async () => {
  await act(async () => {
    await useStore.getState().updateConfig((c) => updateProject(c, 'p1', { bookmarked: true }));
  });
  const label = () => container.querySelector<HTMLElement>('.bookmarks-label')!;
  expect(label().querySelector('svg')?.getAttribute('data-icon')).toBe('chevron');
  expect(label().className).toContain('open');
  await click(label());
  expect(useStore.getState().config.bookmarksCollapsed).toBe(true);
  expect(saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ bookmarksCollapsed: true }));
  expect(bookmarkRows()).toEqual([]);
  expect(label().className).not.toContain('open');
  await click(label());
  expect(useStore.getState().config.bookmarksCollapsed).toBe(false);
  expect(bookmarkRows()).toEqual(['owndevbox']);
});
