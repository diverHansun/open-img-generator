import { describe, expect, it } from 'vitest';

import { deriveDisplayStatus } from './generation-status';

describe('generation display status', () => {
  it('derives partial completion only from a terminal mixed job set', () => {
    expect(
      deriveDisplayStatus('completed', [
        { status: 'completed' },
        { status: 'failed' },
      ]),
    ).toBe('partial');
    expect(
      deriveDisplayStatus('running', [
        { status: 'completed' },
        { status: 'running' },
      ]),
    ).toBe('running');
  });
});
