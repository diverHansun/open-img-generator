import { describe, expect, it } from 'vitest';

import { formatDateTime, formatRelativeTime } from './format';

describe('localized time formatting', () => {
  it('formats relative time in both supported locales', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    const earlier = '2026-07-20T10:00:00.000Z';

    expect(formatRelativeTime(earlier, 'zh-CN', now)).toContain('2');
    expect(formatRelativeTime(earlier, 'en', now)).toBe('2 hours ago');
  });

  it('returns an empty string for invalid timestamps', () => {
    expect(formatRelativeTime('not-a-date', 'en')).toBe('');
    expect(formatDateTime('not-a-date', 'zh-CN')).toBe('');
  });
});
