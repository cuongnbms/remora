import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Config } from '../lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { listFonts, saveConfig } = vi.hoisted(() => ({
  listFonts: vi.fn(async () => [
    { family: 'Helvetica', monospace: false },
    { family: 'Menlo', monospace: true },
  ]),
  saveConfig: vi.fn(async (_c: unknown) => undefined),
}));

vi.mock('../lib/api', () => ({
  api: { listFonts, saveConfig },
  errorMessage: (e: unknown) => String(e),
}));

import { DEFAULT_SETTINGS } from '../lib/settings';
import { useStore } from '../store';
import { SettingsDialog } from './SettingsDialog';

const config: Config = { version: 1, groups: [], settings: DEFAULT_SETTINGS };
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let container: HTMLDivElement;
let root: Root;
let onClose: () => void;

const settings = () => useStore.getState().config.settings;
const selects = () => [...container.querySelectorAll('select')];

async function change(el: HTMLSelectElement | HTMLInputElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await flush();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  useStore.getState().init(config, null);
  onClose = vi.fn(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsDialog, { onClose }));
    await flush();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SettingsDialog', () => {
  test('theme buttons save the chosen mode', async () => {
    const dark = [...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Dark') as HTMLButtonElement;
    await act(async () => {
      dark.click();
      await flush();
    });
    expect(settings().theme).toBe('dark');
    expect(saveConfig).toHaveBeenCalledWith({ ...config, settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    expect(dark.getAttribute('aria-checked')).toBe('true');
  });

  test('font dropdowns list system fonts, monospace first for code', async () => {
    const [ui, code] = selects();
    expect([...ui.options].map((o) => o.value)).toEqual(['', 'Helvetica', 'Menlo']);
    expect([...code.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Monospace', 'Other']);
    expect(code.querySelector('optgroup[label="Monospace"] option')?.textContent).toBe('Menlo');

    await change(code, 'Menlo');
    expect(settings().codeFont).toBe('Menlo');
    await change(code, '');
    expect(settings().codeFont).toBeNull();
  });

  test('keeps a configured font that is no longer installed', async () => {
    await act(async () => {
      await useStore.getState().updateSettings({ uiFont: 'Gone Sans' });
    });
    expect(selects()[0].value).toBe('Gone Sans');
    expect(selects()[0].selectedOptions[0].textContent).toBe('Gone Sans (not installed)');
  });

  test('font size saves only valid values', async () => {
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    await change(input, '9');
    expect(settings().fontSize).toBe(13);
    await change(input, '16');
    expect(settings().fontSize).toBe(16);
  });

  test('excluded names save one per line on blur, and reset to the default list', async () => {
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe(DEFAULT_SETTINGS.excludes.join('\n'));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, ' node_modules\n\nout\n');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      area.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await flush();
    });
    expect(settings().excludes).toEqual(['node_modules', 'out']);
    expect(area.value).toBe('node_modules\nout');

    const resetList = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reset list')!;
    await act(async () => {
      resetList.click();
      await flush();
    });
    expect(settings().excludes).toEqual(DEFAULT_SETTINGS.excludes);
    expect(area.value).toBe(DEFAULT_SETTINGS.excludes.join('\n'));
  });

  test('reset restores defaults and Escape closes', async () => {
    await act(async () => {
      await useStore.getState().updateSettings({ theme: 'light', uiFont: 'Helvetica', fontSize: 18 });
    });
    const reset = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reset to defaults')!;
    await act(async () => {
      reset.click();
      await flush();
    });
    expect(settings()).toEqual(DEFAULT_SETTINGS);

    await act(async () => {
      container.querySelector('.modal')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
