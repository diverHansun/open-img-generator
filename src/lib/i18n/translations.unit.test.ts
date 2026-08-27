import { describe, expect, it } from 'vitest';

import { en, zhCN } from './translations';

describe('interface translations', () => {
  it('keeps Chinese and English dictionaries structurally aligned', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('does not ship empty interface messages', () => {
    expect(Object.values(zhCN).every((message) => message.trim().length > 0)).toBe(true);
    expect(Object.values(en).every((message) => message.trim().length > 0)).toBe(true);
  });
});
