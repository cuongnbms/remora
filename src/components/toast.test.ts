import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/api', () => ({ api: {}, errorMessage: String }));

import { useStore } from '../store';
import { Toast } from './Toast';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({ toast: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Toast)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const set = (t: Parameters<ReturnType<typeof useStore.getState>['setToast']>[0]) =>
  act(() => useStore.getState().setToast(t));

describe('Toast', () => {
  test('a plain string still shows and hides after 6 s', () => {
    set('Saved config');
    expect(container.querySelector('.toast')?.textContent).toBe('Saved config');
    act(() => vi.advanceTimersByTime(6000));
    expect(container.querySelector('.toast')).toBeNull();
  });

  test('setting an empty string clears the toast instead of showing a blank box', () => {
    set('Saved config');
    expect(container.querySelector('.toast')).not.toBeNull();
    set('');
    expect(container.querySelector('.toast')).toBeNull();
  });

  test('a sticky toast stays until replaced', () => {
    set({ text: 'Uploading a.png to /…', sticky: true });
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.querySelector('.toast')?.textContent).toBe('Uploading a.png to /…');
    set('Uploaded to /: a.png');
    expect(container.querySelector('.toast')?.textContent).toBe('Uploaded to /: a.png');
  });

  test('the action button runs its callback and closes the toast', () => {
    const run = vi.fn();
    set({ text: 'Saved a.md', action: { label: 'Show in Finder', run } });
    const button = container.querySelector<HTMLButtonElement>('.toast-action')!;
    expect(button.textContent).toBe('Show in Finder');
    act(() => button.click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(useStore.getState().toast).toBeNull();
  });
});
