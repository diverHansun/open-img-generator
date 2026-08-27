import { describe, expect, it } from 'vitest';

import { getPaginationItems } from './pagination';

describe('pagination window', () => {
  it('returns every page for short result sets', () => {
    expect(getPaginationItems(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('keeps boundary pages and a compact window for long result sets', () => {
    expect(getPaginationItems(5, 10)).toEqual([
      1,
      'ellipsis-start',
      4,
      5,
      6,
      'ellipsis-end',
      10,
    ]);
  });
});
