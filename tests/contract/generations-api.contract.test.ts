import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ValidationError,
  NotFoundError,
  SchemaNotReadyError,
} from '../../src/lib/errors';
import { GET as getGeneration } from '../../src/app/api/generations/[id]/route';
import { POST as cancelGeneration } from '../../src/app/api/generations/[id]/cancel/route';
import { GET as listGenerations, POST as postGeneration } from '../../src/app/api/generations/route';

vi.mock('../../src/lib/job-engine', () => ({
  submitGeneration: vi.fn(),
  getGeneration: vi.fn(),
  cancelGeneration: vi.fn(),
  ensureWorkerStarted: vi.fn(),
}));

vi.mock('../../src/lib/library', () => ({
  listGenerations: vi.fn(),
}));

vi.mock('../../src/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/db')>();
  return {
    ...original,
    assertDatabaseReady: vi.fn(),
  };
});

import * as jobEngine from '../../src/lib/job-engine';
import * as library from '../../src/lib/library';
import * as database from '../../src/lib/db';

describe('GET /api/generations', () => {
  it('delegates to the read-only list query without advancing jobs', async () => {
    vi.mocked(library.listGenerations).mockReturnValue({
      items: [],
      nextCursor: null,
    });
    const response = listGenerations(
      new Request(
        'http://localhost:3000/api/generations?sessionId=session-1&limit=10',
      ),
    );

    expect(response.status).toBe(200);
    expect(library.listGenerations).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        projectId: undefined,
        cursor: undefined,
        limit: 10,
      },
      expect.anything(),
    );
    expect(jobEngine.getGeneration).not.toHaveBeenCalled();
  });
});

describe('POST /api/generations', () => {
  beforeEach(() => {
    vi.mocked(jobEngine.submitGeneration).mockReset();
    vi.mocked(jobEngine.ensureWorkerStarted).mockReset();
    vi.mocked(database.assertDatabaseReady).mockReset();
  });

  it('returns 201 with id, status and self link', async () => {
    vi.mocked(jobEngine.submitGeneration).mockResolvedValue({
      generationId: 'gen-1',
      status: 'pending',
    });

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }], prompt: 'A cat', sessionId: 'session-1' }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe('gen-1');
    expect(body.status).toBe('pending');
    expect(body.links.self).toBe('/api/generations/gen-1');
  });

  it('returns 400 for validation errors', async () => {
    vi.mocked(jobEngine.submitGeneration).mockRejectedValue(new ValidationError('Provider not enabled'));

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }], prompt: 'A cat', sessionId: 'session-1' }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Provider not enabled');
  });

  it('returns 400 when sessionId is missing', async () => {
    vi.mocked(jobEngine.submitGeneration).mockRejectedValue(
      new ValidationError('Session is required'),
    );

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
          prompt: 'A cat',
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Session is required',
    });
  });

  it('returns 503 before worker or provider dispatch when the schema is not ready', async () => {
    vi.mocked(database.assertDatabaseReady).mockImplementation(() => {
      throw new SchemaNotReadyError({
        currentVersion: 0,
        requiredVersion: 1,
        missingTables: [],
        missingColumns: ['generation_jobs.next_poll_at'],
        missingIndexes: [],
        foreignKeysEnabled: true,
      });
    });

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
          prompt: 'A cat',
          sessionId: 'session-1',
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(jobEngine.ensureWorkerStarted).not.toHaveBeenCalled();
    expect(jobEngine.submitGeneration).not.toHaveBeenCalled();
  });
});

describe('GET /api/generations/:id', () => {
  beforeEach(() => {
    vi.mocked(jobEngine.getGeneration).mockReset();
  });

  it('returns generation view', async () => {
    vi.mocked(jobEngine.getGeneration).mockResolvedValue({
      id: 'gen-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      prompt: 'A cat',
      status: 'completed',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
      jobs: [],
      images: [
        {
          id: 'image-1',
          jobId: 'job-1',
          index: 0,
          url: '/api/images/image-1',
          width: 1024,
          height: 1024,
          favorited: true,
        },
      ],
    });

    const response = await getGeneration(
      new Request('http://localhost:3000/api/generations/gen-1'),
      { params: Promise.resolve({ id: 'gen-1' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('gen-1');
    expect(body.status).toBe('completed');
    expect(body.images[0]).toMatchObject({ id: 'image-1', favorited: true });
  });

  it('returns 404 for missing generation', async () => {
    vi.mocked(jobEngine.getGeneration).mockRejectedValue(new NotFoundError('Generation not found'));

    const response = await getGeneration(
      new Request('http://localhost:3000/api/generations/missing'),
      { params: Promise.resolve({ id: 'missing' }) },
    );

    expect(response.status).toBe(404);
  });
});

describe('POST /api/generations/:id/cancel', () => {
  beforeEach(() => {
    vi.mocked(jobEngine.cancelGeneration).mockReset();
  });

  it('returns the same favorite-aware image shape as generation detail', async () => {
    vi.mocked(jobEngine.cancelGeneration).mockResolvedValue({
      id: 'gen-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      prompt: 'A cat',
      status: 'cancelled',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:01:00.000Z',
      jobs: [],
      images: [
        {
          id: 'image-1',
          jobId: 'job-1',
          index: 0,
          url: '/api/images/image-1',
          width: 1024,
          height: 1024,
          favorited: true,
        },
      ],
    });

    const response = await cancelGeneration(
      new Request('http://localhost:3000/api/generations/gen-1/cancel', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'gen-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images[0]).toEqual({
      id: 'image-1',
      jobId: 'job-1',
      index: 0,
      url: '/api/images/image-1',
      width: 1024,
      height: 1024,
      favorited: true,
    });
  });
});
