import { describe, expect, it } from 'vitest';

import {
  MAX_SYNC_IMAGE_GENERATION_TIMEOUT_MS,
  resolveSyncImageGenerationTimeoutMs,
  SYNC_IMAGE_GENERATION_TIMEOUT_MS,
} from './timeout-policy';

describe('sync image generation timeout policy', () => {
  it('uses a three-minute default and never permits a larger request budget', () => {
    expect(SYNC_IMAGE_GENERATION_TIMEOUT_MS).toBe(180_000);
    expect(MAX_SYNC_IMAGE_GENERATION_TIMEOUT_MS).toBe(180_000);
    expect(resolveSyncImageGenerationTimeoutMs()).toBe(180_000);
    expect(resolveSyncImageGenerationTimeoutMs('180000')).toBe(180_000);
    expect(resolveSyncImageGenerationTimeoutMs('180001')).toBe(180_000);
  });

  it('rejects malformed, fractional, and non-positive configuration', () => {
    for (const value of ['', '0', '-1', '30000.5', '3m', 'Infinity']) {
      expect(resolveSyncImageGenerationTimeoutMs(value)).toBe(180_000);
    }
  });
});
