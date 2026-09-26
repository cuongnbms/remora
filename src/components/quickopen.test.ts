import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuickOpen } from './QuickOpen';
import { useStore } from '../store';
import { DEFAULT_SETTINGS } from '../lib/settings';

const files = ['docs/other.md', 'docs/architecture-current.md', 'src/App.tsx'];
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let container: HTMLDivElement;
let root: Root;

const render = () =>
  act(async () => {
    root.render(createElement(QuickOpen));
    await flush();
  });

const setQuickOpen = (open: boolean) =>
  act(async () => {
    useStore.getState().setQuickOpen(open);
    await flush();
  });

const items = () => [...container.querySelectorAll('.quickopen li')];
const labels = () => items().map((i) => i.textContent);
const input = () => container.querySelector('.quickopen input') as HTMLInputElement;
const setInput = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const type = (value: string) =>
  act(async () => {
    setInput(input(), value);
    await flush();
  });
const key = (value: string) =>
  act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    await flush();
  });
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  });

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    ready: true,
    config: { version: 1, groups: [], settings: DEFAULT_SETTINGS },
    activeProjectId: 'p1',
    views: { p1: { tabs: [], active: null, preview: null, files, filesGeneration: 0 } },
    hosts: {},
    lastBatch: null,
    pendingHash: null,
    toast: null,
    quickOpen: false,
    reloadSeq: 0,
    findRequest: null,
    editRequest: null,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('QuickOpen', () => {
  test('renders nothing while closed or without an active project', async () => {
    await render();
    expect(container.querySelector('.modal-backdrop')).toBeNull();

    await act(async () => {
      useStore.setState({ activeProjectId: null });
      await flush();
    });
    await setQuickOpen(true);
    expect(container.querySelector('.modal-backdrop')).toBeNull();
  });

  test('filters fuzzy results, shows basename plus directory and opens the selection on Enter', async () => {
    await render();
    await setQuickOpen(true);
    expect(labels()).toEqual(['other.md docs', 'architecture-current.md docs', 'App.tsx src']);

    await type('archcur');
    expect(labels()).toEqual(['architecture-current.md docs']);

    await key('Enter');
    expect(useStore.getState().quickOpen).toBe(false);
    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['docs/architecture-current.md'], active: 'docs/architecture-current.md' });
  });

  test('resets the query when reopened', async () => {
    await render();
    await setQuickOpen(true);
    await type('archcur');
    expect(input().value).toBe('archcur');

    await setQuickOpen(false);
    await setQuickOpen(true);
    expect(input().value).toBe('');
    expect(labels()).toHaveLength(3);
  });

  test('moves the selection with the arrow keys and clamps at both ends', async () => {
    await render();
    await setQuickOpen(true);
    expect(items()[0].className).toBe('selected');

    await key('ArrowUp');
    expect(items()[0].className).toBe('selected');

    await key('ArrowDown');
    expect(items()[1].className).toBe('selected');

    await key('ArrowDown');
    await key('ArrowDown');
    expect(items()[2].className).toBe('selected');

    await key('ArrowDown');
    expect(items()[2].className).toBe('selected');

    await key('Enter');
    expect(useStore.getState().views.p1.active).toBe('src/App.tsx');
  });

  test('hovering a row selects it and clicking opens it', async () => {
    await render();
    await setQuickOpen(true);
    await act(async () => {
      items()[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
      await flush();
    });
    expect(items()[2].className).toBe('selected');

    await click(items()[1]);
    expect(useStore.getState().views.p1.active).toBe('docs/architecture-current.md');
    expect(useStore.getState().quickOpen).toBe(false);
  });

  test('escape and backdrop clicks close it without opening a file', async () => {
    await render();
    await setQuickOpen(true);
    await key('Escape');
    expect(useStore.getState().quickOpen).toBe(false);
    expect(useStore.getState().views.p1.active).toBeNull();

    await setQuickOpen(true);
    await click(container.querySelector('.modal-backdrop') as Element);
    expect(useStore.getState().quickOpen).toBe(false);

    await setQuickOpen(true);
    await click(container.querySelector('.quickopen') as Element);
    expect(useStore.getState().quickOpen).toBe(true);
  });

  test('shows a loading row until the file list arrives', async () => {
    await act(async () => {
      useStore.setState({ views: { p1: { tabs: [], active: null, preview: null, files: null, filesGeneration: 0 } } });
      await flush();
    });
    await render();
    await setQuickOpen(true);
    expect(labels()).toEqual(['Loading file list…']);

    await act(async () => {
      useStore.getState().setFiles('p1', files);
      await flush();
    });
    expect(labels()).toHaveLength(3);
  });
});
