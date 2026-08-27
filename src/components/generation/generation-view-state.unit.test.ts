import { describe, expect, it } from 'vitest';

import type { GenerationView } from '@/lib/web-client';

import { reconcileGenerationSnapshot } from './generation-view-state';

function view(
  updatedAt: string,
  status: GenerationView['status'] = 'running',
): GenerationView {
  return {
    id: 'generation-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    prompt: 'prompt',
    status,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt,
    jobs: [
      {
        id: 'job-1',
        provider: 'fal',
        model: 'model-1',
        status,
      },
    ],
    images: [],
  };
}

describe('reconcileGenerationSnapshot', () => {
  it('keeps a newer cancellation response when an older poll arrives later', () => {
    const cancelled = view('2026-07-20T00:00:02.000Z', 'cancelled');
    const stalePoll = view('2026-07-20T00:00:01.000Z', 'running');
    expect(reconcileGenerationSnapshot(cancelled, stalePoll)).toBe(cancelled);
  });

  it('does not regress terminal state or remove an emitted image at equal time', () => {
    const completed = view('2026-07-20T00:00:02.000Z', 'completed');
    completed.images = [
      {
        id: 'image-1',
        jobId: 'job-1',
        index: 0,
        url: '/api/images/image-1',
        width: 512,
        height: 512,
        favorited: false,
        availability: 'available',
        removedAt: null,
      },
    ];
    const regressed = view('2026-07-20T00:00:02.000Z', 'running');
    expect(reconcileGenerationSnapshot(completed, regressed)).toBe(completed);
  });

  it('accepts a genuinely newer monotonic snapshot', () => {
    const current = view('2026-07-20T00:00:01.000Z', 'pending');
    const incoming = view('2026-07-20T00:00:02.000Z', 'running');
    expect(reconcileGenerationSnapshot(current, incoming)).toBe(incoming);
  });
});
