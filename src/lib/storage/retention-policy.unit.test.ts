import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseImageRetentionDays,
  resetRetentionPolicyWarningForTests,
} from './retention-policy';

describe('image retention policy', () => {
  beforeEach(() => resetRetentionPolicyWarningForTests());

  it('defaults to seven days and lets zero disable automatic expiry', () => {
    expect(parseImageRetentionDays(undefined)).toEqual({ days: 7, enabled: true });
    expect(parseImageRetentionDays('0')).toEqual({ days: 0, enabled: false });
  });

  it.each(['1', '7', '30', '36500'])('accepts %s whole days', (value) => {
    expect(parseImageRetentionDays(value)).toEqual({
      days: Number(value),
      enabled: true,
    });
  });

  it.each(['-1', '1.5', 'NaN', 'Infinity', '36501', '7 days']) (
    'falls back safely for %s',
    (value) => {
      const warn = vi.fn();
      expect(parseImageRetentionDays(value, warn)).toEqual({ days: 7, enabled: true });
      expect(parseImageRetentionDays(value, warn)).toEqual({ days: 7, enabled: true });
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );
});
