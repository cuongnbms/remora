import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Config } from '../lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useShortcuts } from './useShortcuts';
import { useStore } from '../store';
import { DEFAULT_SETTINGS } from '../lib/settings';

const config: Config = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  groups: [
    {
      id: 'g1',
      name: 'G',
      collapsed: false,
      subgroups: [],
      projects: [
        { id: 'p1', name: 'one', host: 'devbox', path: '/w/one' },
        { id: 'p2', name: 'two', host: 'devbox', path: '/w/two' },
      ],
    },
  ],
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let container: HTMLDivElement;
let root: Root;
let left: () => void;
let right: () => void;

function Harness({ toggleLeft, toggleRight }: { toggleLeft: () => void; toggleRight: () => void }) {
  useShortcuts({ toggleLeft, toggleRight });
  return null;
}

const render = (handlers: { toggleLeft: () => void; toggleRight: () => void }) =>
  act(async () => {
    root.render(createElement(Harness, handlers));
    await flush();
  });

const press = (init: KeyboardEventInit & { code: string }) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, bubbles: true, cancelable: true, ...init }));
    await flush();
  });

const prevented = (init: KeyboardEventInit & { code: string }) => {
  const event = new KeyboardEvent('keydown', { metaKey: true, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeEach(() => {
  localStorage.clear();
  left = vi.fn(() => {});
  right = vi.fn(() => {});
  useStore.setState({
    ready: true,
    config,
    activeProjectId: 'p1',
    views: { p1: { tabs: ['a.md', 'b.md'], active: 'a.md', preview: null, files: null, filesGeneration: 0 } },
    hosts: {},
    lastBatch: null,
    pendingHash: null,
    toast: null,
    quickOpen: false,
    settingsOpen: false,
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

describe('useShortcuts', () => {
  test('cmd+b toggles the left panel and cmd+alt+b toggles the right panel', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'KeyB' });
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();

    await press({ code: 'KeyB', altKey: true });
    expect(right).toHaveBeenCalledTimes(1);
  });

  test('cmd+p opens quick open and cmd+r bumps the reload sequence', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'KeyP' });
    expect(useStore.getState().quickOpen).toBe(true);

    await press({ code: 'KeyR' });
    expect(useStore.getState().reloadSeq).toBe(1);
  });

  test('cmd+f opens find, cmd+g and cmd+shift+g step through matches', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'KeyF' });
    expect(useStore.getState().findRequest).toEqual({ action: 'open', seq: 1 });

    await press({ code: 'KeyG' });
    expect(useStore.getState().findRequest).toEqual({ action: 'next', seq: 2 });

    await press({ code: 'KeyG', shiftKey: true });
    expect(useStore.getState().findRequest).toEqual({ action: 'prev', seq: 3 });
  });

  test('cmd+comma opens settings', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'Comma' });
    expect(useStore.getState().settingsOpen).toBe(true);
  });

  test('cmd+w closes the active tab and is a no-op with no active tab', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'KeyW' });
    expect(useStore.getState().views.p1).toMatchObject({ tabs: ['b.md'], active: 'b.md' });

    useStore.setState({ views: { p1: { tabs: [], active: null, preview: null, files: null, filesGeneration: 0 } } });
    await press({ code: 'KeyW' });
    expect(useStore.getState().views.p1.tabs).toEqual([]);
  });

  test('cmd+shift+bracket cycles tabs backwards and forwards', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'BracketRight', shiftKey: true });
    expect(useStore.getState().views.p1.active).toBe('b.md');

    await press({ code: 'BracketLeft', shiftKey: true });
    expect(useStore.getState().views.p1.active).toBe('a.md');
  });

  test('cmd+digit selects the nth flat project, including across groups', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'Digit2' });
    expect(useStore.getState().activeProjectId).toBe('p2');

    await press({ code: 'Digit1' });
    expect(useStore.getState().activeProjectId).toBe('p1');
  });

  test('only handled shortcuts prevent the default browser action', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    expect(prevented({ code: 'KeyP' })).toBe(true);
    expect(prevented({ code: 'Digit9' })).toBe(false);
    expect(prevented({ code: 'KeyS' })).toBe(false);
    expect(prevented({ code: 'KeyP', metaKey: false })).toBe(false);
    expect(prevented({ code: 'KeyB', ctrlKey: true, metaKey: false })).toBe(false);
  });

  test('uses the latest handlers without re-registering the listener', async () => {
    await render({ toggleLeft: left, toggleRight: right });
    await press({ code: 'KeyB' });
    expect(left).toHaveBeenCalledTimes(1);

    const nextLeft = vi.fn(() => {});
    await render({ toggleLeft: nextLeft, toggleRight: right });
    await press({ code: 'KeyB' });
    expect(nextLeft).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledTimes(1);
  });
});
