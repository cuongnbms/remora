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
