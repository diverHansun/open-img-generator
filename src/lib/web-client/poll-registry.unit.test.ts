import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from './api-client';
import { GenerationPollRegistry, type PollScheduler } from './poll-registry';
import type { GenerationView } from './types';

const pending: GenerationView = {
  id: 'generation-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  prompt: 'A cat',
  status: 'pending',
  createdAt: 'now',
  updatedAt: 'now',
  jobs: [
    { id: 'job-1', provider: 'fal', model: 'fal-ai/flux/schnell', status: 'pending' },
  ],
  images: [],
};

const completed: GenerationView = {
  ...pending,
  status: 'completed',
  jobs: [{ ...pending.jobs[0]!, status: 'completed' }],
};

function createScheduler() {
  const timers: Array<{ callback: () => void; milliseconds: number; active: boolean }> = [];
  const scheduler: PollScheduler = {
    setTimeout: (callback, milliseconds) => {
      const timer = { callback, milliseconds, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as { active: boolean }).active = false;
    },
  };
  return { scheduler, timers };
}

describe('GenerationPollRegistry', () => {
  it('shares a detail GET for duplicate subscribers and stops after the final unsubscribe', async () => {
    const getGenerationById = vi.fn().mockResolvedValue(pending);
    const { scheduler, timers } = createScheduler();
    const registry = new GenerationPollRegistry({ getGenerationById }, scheduler);
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = registry.subscribe('generation-1', { onUpdate: first });
    const unsubscribeSecond = registry.subscribe('generation-1', { onUpdate: second });
    await vi.waitFor(() => expect(getGenerationById).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith(pending));

    expect(second).toHaveBeenCalledWith(pending);
    expect(timers).toEqual([
      expect.objectContaining({ milliseconds: 2_000, active: true }),
    ]);
    expect(registry.subscriptionCount('generation-1')).toBe(2);

    unsubscribeFirst();
    expect(timers[0]!.active).toBe(true);
    unsubscribeSecond();
    expect(timers[0]!.active).toBe(false);
    expect(registry.subscriptionCount('generation-1')).toBe(0);
  });

  it('keeps one scheduler across retries and removes terminal generations', async () => {
    const getGenerationById = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(completed);
    const { scheduler, timers } = createScheduler();
    const registry = new GenerationPollRegistry({ getGenerationById }, scheduler);
    const onUpdate = vi.fn();

    registry.subscribe('generation-1', { onUpdate });
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    timers[0]!.callback();
    await vi.waitFor(() => expect(getGenerationById).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith(completed));

    expect(registry.subscriptionCount('generation-1')).toBe(0);
    expect(timers).toHaveLength(1);
  });

  it('stops on a non-retryable detail error', async () => {
    const getGenerationById = vi
      .fn()
      .mockRejectedValue(new ApiClientError('Not found', 404, 'NOT_FOUND', false));
    const { scheduler, timers } = createScheduler();
    const registry = new GenerationPollRegistry({ getGenerationById }, scheduler);
    const onError = vi.fn();

    registry.subscribe('generation-1', { onUpdate: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    expect(onError).toHaveBeenCalledWith(expect.any(ApiClientError));
    expect(registry.subscriptionCount('generation-1')).toBe(0);
    expect(timers).toHaveLength(0);
  });

  it('backs off retryable detail failures without creating another scheduler', async () => {
    const getGenerationById = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError('Temporary failure', 503, 'UNAVAILABLE', true))
      .mockResolvedValueOnce(pending);
    const { scheduler, timers } = createScheduler();
    const registry = new GenerationPollRegistry({ getGenerationById }, scheduler);
    const onError = vi.fn();

    registry.subscribe('generation-1', { onUpdate: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(timers).toEqual([
      expect.objectContaining({ milliseconds: 2_000, active: true }),
    ]);

    timers[0]!.callback();
    await vi.waitFor(() => expect(getGenerationById).toHaveBeenCalledTimes(2));
    expect(timers).toHaveLength(2);
    expect(timers[1]).toEqual(expect.objectContaining({ milliseconds: 4_000, active: true }));
    expect(registry.subscriptionCount('generation-1')).toBe(1);
  });

  it('aborts an in-flight detail request when its final subscriber leaves', async () => {
    let signal: AbortSignal | undefined;
    const getGenerationById = vi.fn(
      (_id: string, options?: { signal?: AbortSignal }) =>
        new Promise<GenerationView>(() => {
          signal = options?.signal;
        }),
    );
    const { scheduler } = createScheduler();
    const registry = new GenerationPollRegistry({ getGenerationById }, scheduler);

    const unsubscribe = registry.subscribe('generation-1', { onUpdate: vi.fn() });
    await vi.waitFor(() => expect(signal).toBeDefined());
    unsubscribe();

    expect(signal?.aborted).toBe(true);
    expect(registry.subscriptionCount('generation-1')).toBe(0);
  });
});
