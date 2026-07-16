import { afterEach, describe, expect, it } from 'vitest';
import { resetProviderLimiters, withProviderLimit } from './limiter';
import { RateLimitError } from '../errors';
import { acquireGenerationSlot, resetGenerationAdmission } from '../job-engine/admission';

describe('concurrency controls', () => {
  const originalPerProvider = process.env.MAX_INFLIGHT_PER_PROVIDER;
  const originalGenerations = process.env.MAX_INFLIGHT_GENERATIONS;

  afterEach(() => {
    resetProviderLimiters();
    resetGenerationAdmission();
    if (originalPerProvider === undefined) delete process.env.MAX_INFLIGHT_PER_PROVIDER;
    else process.env.MAX_INFLIGHT_PER_PROVIDER = originalPerProvider;
    if (originalGenerations === undefined) delete process.env.MAX_INFLIGHT_GENERATIONS;
    else process.env.MAX_INFLIGHT_GENERATIONS = originalGenerations;
  });

  it('limits provider calls without serializing different providers', async () => {
    process.env.MAX_INFLIGHT_PER_PROVIDER = '1';
    let releaseFirst!: () => void;
    const first = withProviderLimit('kling', () => new Promise((resolve) => { releaseFirst = () => resolve('first'); }));
    let secondStarted = false;
    const second = withProviderLimit('kling', async () => {
      secondStarted = true;
      return 'second';
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(secondStarted).toBe(true);
  });

  it('rejects generation admission above the configured ceiling', () => {
    process.env.MAX_INFLIGHT_GENERATIONS = '1';
    const release = acquireGenerationSlot();
    expect(() => acquireGenerationSlot()).toThrow(RateLimitError);
    release();
    expect(() => acquireGenerationSlot()).not.toThrow();
  });
});
