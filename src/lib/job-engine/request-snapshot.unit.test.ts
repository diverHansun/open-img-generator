import { describe, expect, it } from 'vitest';

import {
  REQUEST_SNAPSHOT_VERSION,
  createRequestSnapshot,
  parseRequestSnapshot,
} from './request-snapshot';

describe('generation request snapshots', () => {
  it('round-trips only normalized provider input', () => {
    const snapshot = createRequestSnapshot({
      prompt: 'A quiet reading room',
      mode: 'text-to-image',
      count: 1,
      providerOptions: { style: 'watercolor', steps: 28 },
    });

    expect(JSON.parse(snapshot)).toEqual({
      prompt: 'A quiet reading room',
      mode: 'text-to-image',
      count: 1,
      providerOptions: { steps: 28, style: 'watercolor' },
    });
    expect(parseRequestSnapshot(snapshot, REQUEST_SNAPSHOT_VERSION)).toEqual({
      prompt: 'A quiet reading room',
      mode: 'text-to-image',
      count: 1,
      providerOptions: { steps: 28, style: 'watercolor' },
    });
  });

  it('rejects an unknown snapshot version or unsafe values', () => {
    const snapshot = createRequestSnapshot({ prompt: 'A cat' });
    expect(() => parseRequestSnapshot(snapshot, 999)).toThrow('snapshot');
    expect(() =>
      createRequestSnapshot({
        prompt: 'A cat',
        providerOptions: { nested: { value: new Date() } },
      }),
    ).toThrow('snapshot');
  });
});
