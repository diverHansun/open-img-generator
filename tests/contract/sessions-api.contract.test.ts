import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../src/lib/errors';
import { GET as getSession } from '../../src/app/api/sessions/[id]/route';
import { POST as postSession } from '../../src/app/api/sessions/route';

vi.mock('../../src/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/db')>();
  return {
    ...original,
    createSession: vi.fn(),
    getSession: vi.fn(),
  };
});

vi.mock('../../src/lib/job-engine', () => ({
  getGeneration: vi.fn(),
}));

import * as db from '../../src/lib/db';
import * as jobEngine from '../../src/lib/job-engine';

describe('POST /api/sessions', () => {
  beforeEach(() => {
    vi.mocked(db.createSession).mockReset();
  });

  it('returns 201 with created session', async () => {
    vi.mocked(db.createSession).mockReturnValue({
      id: 'session-1',
      title: 'Demo',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
    });

    const response = await postSession(
      new Request('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Demo' }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe('session-1');
    expect(body.title).toBe('Demo');
  });
});

describe('GET /api/sessions/:id', () => {
  beforeEach(() => {
    vi.mocked(db.getSession).mockReset();
    vi.mocked(jobEngine.getGeneration).mockReset();
  });

  it('returns session with generations and advances pending ones', async () => {
    vi.mocked(db.getSession).mockReturnValue({
      id: 'session-1',
      title: 'Demo',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
      generations: [
        {
          id: 'gen-1',
          sessionId: 'session-1',
          prompt: 'A cat',
          status: 'pending',
          createdAt: '2026-07-12T10:00:00.000Z',
          updatedAt: '2026-07-12T10:00:00.000Z',
          jobs: [],
          images: [],
        },
      ],
    });
    vi.mocked(jobEngine.getGeneration).mockResolvedValue({
      id: 'gen-1',
      sessionId: 'session-1',
      prompt: 'A cat',
      status: 'completed',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
      jobs: [],
      images: [],
    });

    const response = await getSession(
      new Request('http://localhost:3000/api/sessions/session-1'),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(200);
    expect(jobEngine.getGeneration).toHaveBeenCalledWith('gen-1', { db: expect.anything() });
  });

  it('returns 404 for missing session', async () => {
    vi.mocked(db.getSession).mockImplementation(() => {
      throw new NotFoundError('Session not found');
    });

    const response = await getSession(
      new Request('http://localhost:3000/api/sessions/missing'),
      { params: Promise.resolve({ id: 'missing' }) },
    );

    expect(response.status).toBe(404);
  });
});
