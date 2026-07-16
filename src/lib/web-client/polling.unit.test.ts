import { describe, expect, it, vi } from 'vitest';
import { GenerationPollingController, areAllJobsTerminal } from './polling';
import type { GenerationView } from './types';

const pending: GenerationView = {
  id: 'gen-1', sessionId: 'session-1', prompt: 'A cat', status: 'pending',
  createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
  jobs: [{ id: 'job-1', provider: 'fal', model: 'fal-ai/flux/schnell', status: 'pending' }],
  images: [],
};

const completed: GenerationView = {
  ...pending,
  status: 'completed',
  jobs: [{ ...pending.jobs[0]!, status: 'completed' }],
};

describe('GenerationPollingController', () => {
  it('polls until every job is terminal and reports each view', async () => {
    const getGeneration = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(completed);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn();
    const controller = new GenerationPollingController({ getGeneration });

    const result = await controller.start('/api/generations/gen-1', { sleep, onUpdate });

    expect(result).toEqual(completed);
    expect(getGeneration).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not treat a partially complete generation as terminal', () => {
    expect(areAllJobsTerminal({
      ...completed,
      jobs: [
        completed.jobs[0]!,
        { id: 'job-2', provider: 'zenmux', model: 'openai/gpt-image-2', status: 'running' },
      ],
    })).toBe(false);
  });

  it('stops without another request when cancelled during backoff', async () => {
    const getGeneration = vi.fn().mockResolvedValue(pending);
    const controller = new GenerationPollingController({ getGeneration });
    const result = await controller.start('/api/generations/gen-1', {
      sleep: async () => controller.cancel(),
    });

    expect(result).toBeUndefined();
    expect(getGeneration).toHaveBeenCalledTimes(1);
  });
});
