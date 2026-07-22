import { describe, expect, it } from 'vitest';

import { formatBytes } from './format-bytes';

describe('settings byte formatting', () => {
  it('labels application-owned image bytes with the correct unit', () => {
    expect(formatBytes(27_412_543, 'en-US')).toBe('26.1 MB');
    expect(formatBytes(520_440, 'en-US')).toBe('508.2 KB');
    expect(formatBytes(107_238, 'en-US')).toBe('104.7 KB');
  });

  it('handles zero and the byte boundary without shifting units', () => {
    expect(formatBytes(0, 'en-US')).toBe('0 B');
    expect(formatBytes(1_024, 'en-US')).toBe('1 KB');
  });
});
