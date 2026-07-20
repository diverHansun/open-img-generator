import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderQueueError,
  resetProviderLimiters,
  withProviderLimit,
} from './limiter';
import { RateLimitError } from '../errors';
import { acquireGenerationSlot, resetGenerationAdmission } from '../job-engine/admission';

describe('concurrency controls', () => {
  const originalPerProvider = process.env.MAX_INFLIGHT_PER_PROVIDER;
  const originalGenerations = process.env.MAX_INFLIGHT_GENERATIONS;
  const originalQueue = process.env.MAX_QUEUED_PER_PROVIDER;
  const originalQueueTimeout = process.env.PROVIDER_QUEUE_TIMEOUT_MS;

  afterEach(() => {
    resetProviderLimiters();
    resetGenerationAdmission();
    if (originalPerProvider === undefined) delete process.env.MAX_INFLIGHT_PER_PROVIDER;
    else process.env.MAX_INFLIGHT_PER_PROVIDER = originalPerProvider;
    if (originalGenerations === undefined) delete process.env.MAX_INFLIGHT_GENERATIONS;
    else process.env.MAX_INFLIGHT_GENERATIONS = originalGenerations;
    if (originalQueue === undefined) delete process.env.MAX_QUEUED_PER_PROVIDER;
    else process.env.MAX_QUEUED_PER_PROVIDER = originalQueue;
    if (originalQueueTimeout === undefined) delete process.env.PROVIDER_QUEUE_TIMEOUT_MS;
    else process.env.PROVIDER_QUEUE_TIMEOUT_MS = originalQueueTimeout;
    vi.useRealTimers();
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

  it('rejects an over-cap queue before its provider task starts', async () => {
    process.env.MAX_INFLIGHT_PER_PROVIDER = '1';
    let release!: () => void;
    const first = withProviderLimit('fal', () => new Promise<string>((resolve) => {
      release = () => resolve('first');
    }));
    await Promise.resolve();
    const queuedTask = vi.fn(async () => 'never');

    await expect(withProviderLimit('fal', queuedTask, { maxQueue: 0 })).rejects.toMatchObject({
      code: 'QUEUE_SATURATED',
      disposition: 'not_started',
    } satisfies Partial<ProviderQueueError>);
    expect(queuedTask).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toBe('first');
  });

  it('allows an idle provider to start immediately when waiting capacity is zero', async () => {
    await expect(withProviderLimit('fal', async () => 'started', {
      maxQueue: 0,
    })).resolves.toBe('started');
  });

  it('removes a timed-out queued task before it can call the provider', async () => {
    vi.useFakeTimers();
    process.env.MAX_INFLIGHT_PER_PROVIDER = '1';
    let release!: () => void;
    const first = withProviderLimit('fal', () => new Promise<string>((resolve) => {
      release = () => resolve('first');
    }));
    await Promise.resolve();
    const queuedTask = vi.fn(async () => 'never');
    const queued = withProviderLimit('fal', queuedTask, { timeoutMs: 10 });
    const rejection = expect(queued).rejects.toMatchObject({ code: 'QUEUE_TIMEOUT' });

    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(queuedTask).not.toHaveBeenCalled();

    release();
    await expect(first).resolves.toBe('first');
  });

  it('removes an aborted queued task and leaves other providers independent', async () => {
    process.env.MAX_INFLIGHT_PER_PROVIDER = '1';
    let release!: () => void;
    const first = withProviderLimit('fal', () => new Promise<string>((resolve) => {
      release = () => resolve('first');
    }));
    await Promise.resolve();
    const controller = new AbortController();
    const blockedTask = vi.fn(async () => 'never');
    const blocked = withProviderLimit('fal', blockedTask, { signal: controller.signal });
    const independent = withProviderLimit('qwen', async () => 'other-provider');
    const rejection = expect(blocked).rejects.toMatchObject({ code: 'QUEUE_ABORTED' });
    controller.abort();

    await rejection;
    await expect(independent).resolves.toBe('other-provider');
    expect(blockedTask).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toBe('first');
  });
});
