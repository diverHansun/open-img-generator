import { describe, expect, it } from 'vitest';

import { accessibleExcerpt } from './a11y';

describe('accessibleExcerpt', () => {
  it('normalizes whitespace and preserves short prompts', () => {
    expect(accessibleExcerpt('  quiet\n\n garden  ')).toBe('quiet garden');
  });

  it('bounds long accessible names and adds an ellipsis', () => {
    expect(accessibleExcerpt('abcdefghij', 6)).toBe('abcde…');
  });
});
