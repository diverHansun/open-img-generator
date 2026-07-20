import { describe, expect, it } from 'vitest';
import { areAllJobsTerminal } from './polling';
import type { GenerationView } from './types';

const pending: GenerationView = {
  id: 'gen-1', sessionId: 'session-1', projectId: 'project-1', prompt: 'A cat', status: 'pending',
  createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
  jobs: [{ id: 'job-1', provider: 'fal', model: 'fal-ai/flux/schnell', status: 'pending' }],
  images: [],
};

const completed: GenerationView = {
  ...pending,
  status: 'completed',
  jobs: [{ ...pending.jobs[0]!, status: 'completed' }],
};

describe('generation polling status', () => {
  it('does not treat a partially complete generation as terminal', () => {
    expect(areAllJobsTerminal({
      ...completed,
      jobs: [
        completed.jobs[0]!,
        { id: 'job-2', provider: 'zenmux', model: 'openai/gpt-image-2', status: 'running' },
      ],
    })).toBe(false);
  });

  it('only treats a non-empty set of terminal jobs as terminal', () => {
    expect(areAllJobsTerminal(completed)).toBe(true);
    expect(areAllJobsTerminal({ ...completed, jobs: [] })).toBe(false);
    expect(areAllJobsTerminal(pending)).toBe(false);
  });
});
