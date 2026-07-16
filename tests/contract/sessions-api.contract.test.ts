import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/lib/errors';
import { GET as getSession } from '../../src/app/api/sessions/[id]/route';
import { POST as postSession } from '../../src/app/api/sessions/route';

vi.mock('../../src/lib/library', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/library')>();
  return {
    ...original,
    getSession: vi.fn(),
    listGenerations: vi.fn(),
  };
});

import * as library from '../../src/lib/library';

describe('POST /api/sessions', () => {
  it('directs callers to the project-scoped creation endpoint', async () => {
    const response = postSession();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Create sessions with POST /api/projects/:id/sessions',
    });
  });
});

describe('GET /api/sessions/:id', () => {
  const session = {
    id: 'session-1',
    projectId: 'project-1',
    title: 'Demo',
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.mocked(library.getSession).mockReset();
    vi.mocked(library.listGenerations).mockReset();
    vi.mocked(library.getSession).mockReturnValue(session);
  });

  it('returns metadata only unless generations are requested', async () => {
    const response = await getSession(
      new Request('http://localhost:3000/api/sessions/session-1'),
      { params: Promise.resolve({ id: 'session-1' }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(session);
    expect(library.listGenerations).not.toHaveBeenCalled();
  });

  it('includes stored generations through a read-only listing', async () => {
    vi.mocked(library.listGenerations).mockReturnValue({
      items: [{
        id: 'gen-1', sessionId: 'session-1', prompt: 'A cat', status: 'pending',
        createdAt: '2026-07-12T10:00:00.000Z', updatedAt: '2026-07-12T10:00:00.000Z',
        jobs: [{
          id: 'job-1', provider: 'fal', model: 'fal-ai/flux/schnell',
          status: 'pending', error: null,
        }],
        images: [],
      }],
      nextCursor: null,
    });

    const response = await getSession(
      new Request('http://localhost:3000/api/sessions/session-1?include=generations'),
      { params: Promise.resolve({ id: 'session-1' }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generations).toHaveLength(1);
    expect(body.generations[0].status).toBe('pending');
    expect(library.listGenerations).toHaveBeenCalledWith(
      { sessionId: 'session-1', limit: 50 }, expect.anything(),
    );
  });

  it('returns 404 for a missing session', async () => {
    vi.mocked(library.getSession).mockImplementation(() => {
      throw new NotFoundError('Session not found');
    });
    const response = await getSession(
      new Request('http://localhost:3000/api/sessions/missing'),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(response.status).toBe(404);
  });
});
