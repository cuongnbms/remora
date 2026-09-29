import { expect, test } from 'vitest';
import { fitMenu } from './ContextMenu';

const viewport = { width: 800, height: 600 };
const size = { width: 180, height: 120 };

test('opens at the cursor when the menu fits', () => {
  expect(fitMenu(100, 100, size, viewport)).toEqual({ left: 100, top: 100 });
});

test('opens upward when it would overflow the bottom edge', () => {
  expect(fitMenu(100, 550, size, viewport)).toEqual({ left: 100, top: 430 });
});

test('opens leftward when it would overflow the right edge', () => {
  expect(fitMenu(700, 100, size, viewport)).toEqual({ left: 520, top: 100 });
});

test('stays inside the viewport when neither side has room', () => {
  expect(fitMenu(100, 60, size, { width: 800, height: 150 })).toEqual({ left: 100, top: 4 });
});
