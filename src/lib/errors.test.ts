import { describe, expect, test } from 'vitest';
import { fileErrorTitle, isConnectionError } from './errors';

describe('isConnectionError', () => {
  test('is true only for ssh and timeout failures', () => {
    expect(isConnectionError('Ssh')).toBe(true);
    expect(isConnectionError('Timeout')).toBe(true);
    expect(isConnectionError('NotFound')).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe('fileErrorTitle', () => {
  test('names the failure by kind', () => {
    expect(fileErrorTitle('Binary', 'devbox')).toBe('Binary file — not shown');
    expect(fileErrorTitle('NotFound', 'devbox')).toBe('File not found');
    expect(fileErrorTitle('TooLarge', 'devbox')).toBe('File is too large to show');
    expect(fileErrorTitle('Ssh', 'devbox')).toBe('Can’t reach devbox');
    expect(fileErrorTitle('Timeout', 'devbox')).toBe('Can’t reach devbox');
    expect(fileErrorTitle('Other', 'devbox')).toBe('Can’t open this file');
    expect(fileErrorTitle(null, 'devbox')).toBe('Can’t open this file');
  });
});
