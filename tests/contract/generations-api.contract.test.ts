import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConfigurationUnavailableError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  SchemaNotReadyError,
} from '../../src/lib/errors';
import { GET as getGeneration } from '../../src/app/api/generations/[id]/route';
import { DELETE as deleteGeneration } from '../../src/app/api/generations/[id]/route';
import { POST as cancelGeneration } from '../../src/app/api/generations/[id]/cancel/route';
import { GET as listGenerations, POST as postGeneration } from '../../src/app/api/generations/route';

vi.mock('../../src/lib/job-engine', () => ({
  submitGeneration: vi.fn(),
  getGeneration: vi.fn(),
  cancelGeneration: vi.fn(),
  deleteGeneration: vi.fn(),
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

const CLIENT_REQUEST_ID = '15a6fecc-4f40-4ed2-8f51-353423be9af1';

function submissionBody(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
    prompt: 'A cat',
    sessionId: 'session-1',
    ...overrides,
  };
}

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

  it('returns 202 after durable admission with id, status and self link', async () => {
    vi.mocked(jobEngine.submitGeneration).mockResolvedValue({
      generationId: 'gen-1',
      status: 'pending',
      replayed: false,
    });

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'submit-request-1',
          'Idempotency-Key': CLIENT_REQUEST_ID,
        },
        body: JSON.stringify(submissionBody()),
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('X-Request-Id')).toBe('submit-request-1');
    expect(response.headers.get('Location')).toBe('/api/generations/gen-1');
    const body = await response.json();
    expect(body.id).toBe('gen-1');
    expect(body.status).toBe('pending');
    expect(body.replayed).toBe(false);
    expect(body.links.self).toBe('/api/generations/gen-1');
    expect(jobEngine.submitGeneration).toHaveBeenCalledWith(
      submissionBody(),
      expect.anything(),
    );
    expect(jobEngine.ensureWorkerStarted).toHaveBeenCalledOnce();
  });

  it('passes more than eight targets to durable admission without an API ceiling', async () => {
    const targets = Array.from({ length: 9 }, (_, index) => ({
      provider: 'fal',
      model: `fal-ai/flux/model-${index}`,
    }));
    vi.mocked(jobEngine.submitGeneration).mockResolvedValue({
      generationId: 'gen-many-targets',
      status: 'pending',
      replayed: false,
    });

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionBody({ targets })),
      }),
    );

    expect(response.status).toBe(202);
    expect(jobEngine.submitGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ targets }),
      expect.anything(),
    );
  });

  it('returns a replay marker without changing the original generation id', async () => {
    vi.mocked(jobEngine.submitGeneration).mockResolvedValue({
      generationId: 'gen-original',
      status: 'completed',
      replayed: true,
    });

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': CLIENT_REQUEST_ID,
        },
        body: JSON.stringify(submissionBody()),
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('Location')).toBe('/api/generations/gen-original');
    await expect(response.json()).resolves.toMatchObject({
      id: 'gen-original',
      status: 'completed',
      replayed: true,
    });
  });

  it('rejects a missing or mismatched request identity before worker dispatch', async () => {
    const missing = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionBody({ clientRequestId: undefined })),
      }),
    );
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', retryable: false },
    });

    const mismatch = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        },
        body: JSON.stringify(submissionBody()),
      }),
    );
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', retryable: false },
    });

    const caseMismatch = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': CLIENT_REQUEST_ID,
        },
        body: JSON.stringify(
          submissionBody({ clientRequestId: CLIENT_REQUEST_ID.toUpperCase() }),
        ),
      }),
    );
    expect(caseMismatch.status).toBe(400);
    expect(jobEngine.ensureWorkerStarted).not.toHaveBeenCalled();
    expect(jobEngine.submitGeneration).not.toHaveBeenCalled();
  });

  it('returns 400 for validation errors', async () => {
    vi.mocked(jobEngine.submitGeneration).mockRejectedValue(new ValidationError('Provider not enabled'));

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionBody()),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      retryable: false,
      requestId: response.headers.get('X-Request-Id'),
    });
  });

  it('returns 400 when sessionId is missing', async () => {
    vi.mocked(jobEngine.submitGeneration).mockRejectedValue(
      new ValidationError('Session is required'),
    );

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionBody({ sessionId: undefined })),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        retryable: false,
        requestId: response.headers.get('X-Request-Id'),
      },
    });
  });

  it('rejects an oversized generation payload before engine or worker dispatch', async () => {
    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...submissionBody(),
          prompt: 'x'.repeat(512 * 1_024),
        }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE', retryable: false },
    });
    expect(jobEngine.ensureWorkerStarted).not.toHaveBeenCalled();
    expect(jobEngine.submitGeneration).not.toHaveBeenCalled();
  });

  it('returns an actionable correlated rate-limit error', async () => {
    vi.mocked(jobEngine.submitGeneration).mockRejectedValue(
      new RateLimitError('raw limiter state must not be exposed'),
    );

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'rate-request-1',
        },
        body: JSON.stringify(submissionBody()),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(response.headers.get('X-Request-Id')).toBe('rate-request-1');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests; retry later',
        retryable: true,
        requestId: 'rate-request-1',
      },
    });
  });

  it('returns a safe correlated configuration error', async () => {
    vi.mocked(jobEngine.submitGeneration).mockRejectedValue(
      new ConfigurationUnavailableError(
        'secret-canary USER_CONFIG_ENCRYPTION_KEY=/private/key',
      ),
    );

    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'config-request-1',
        },
        body: JSON.stringify(submissionBody()),
      }),
    );
    const bodyText = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('X-Request-Id')).toBe('config-request-1');
    expect(bodyText).toContain('Provider configuration is unavailable');
    expect(bodyText).not.toContain('secret-canary');
    expect(bodyText).not.toContain('/private/key');
  });

  it('redacts raw internal errors while retaining their request correlation', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const canary =
      'secret-canary prompt /private/app.db https://signed.test/?token=private';
    vi.mocked(jobEngine.submitGeneration).mockRejectedValue(new Error(canary));

    try {
      const response = await postGeneration(
        new Request('http://localhost:3000/api/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': 'internal-request-1',
          },
          body: JSON.stringify(
            submissionBody({ prompt: 'another secret prompt' }),
          ),
        }),
      );
      const bodyText = await response.text();
      const logText = logSpy.mock.calls.flat().join(' ');

      expect(response.status).toBe(500);
      expect(response.headers.get('X-Request-Id')).toBe('internal-request-1');
      expect(bodyText).toContain('INTERNAL_ERROR');
      expect(bodyText).toContain('internal-request-1');
      expect(JSON.parse(bodyText).error.retryable).toBe(false);
      expect(bodyText).not.toContain(canary);
      expect(logText).toContain('internal-request-1');
      expect(logText).not.toContain(canary);
      expect(logText).not.toContain('another secret prompt');
    } finally {
      logSpy.mockRestore();
    }
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
        body: JSON.stringify(submissionBody()),
      }),
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: 'SCHEMA_NOT_READY',
      retryable: false,
      requestId: response.headers.get('X-Request-Id'),
      details: {
        currentVersion: 0,
        requiredVersion: 1,
        missingColumns: ['generation_jobs.next_poll_at'],
      },
    });
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
          delivery: 'managed',
          availability: 'available',
          removedAt: null,
        },
      ],
    });

    const response = await getGeneration(
      new Request('http://localhost:3000/api/generations/gen-1', {
        headers: { 'X-Request-Id': 'detail-request-1' },
      }),
      { params: Promise.resolve({ id: 'gen-1' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBe('detail-request-1');
    const body = await response.json();
    expect(body.id).toBe('gen-1');
    expect(body.status).toBe('completed');
    expect(body.images[0]).toMatchObject({ id: 'image-1', favorited: true });
  });

  it('returns 404 for missing generation', async () => {
    vi.mocked(jobEngine.getGeneration).mockRejectedValue(new NotFoundError('Generation not found'));

    const response = await getGeneration(
      new Request('http://localhost:3000/api/generations/missing', {
        headers: { 'X-Request-Id': 'detail-request-2' },
      }),
      { params: Promise.resolve({ id: 'missing' }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('X-Request-Id')).toBe('detail-request-2');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
        retryable: false,
        requestId: 'detail-request-2',
      },
    });
  });
});

describe('DELETE /api/generations/:id', () => {
  beforeEach(() => vi.mocked(jobEngine.deleteGeneration).mockReset());

  it('deletes a terminal generation with no request body', async () => {
    const response = await deleteGeneration(
      new Request('http://localhost:3000/api/generations/gen-1', {
        method: 'DELETE',
        headers: { 'X-Request-Id': 'delete-request-1' },
      }),
      { params: Promise.resolve({ id: 'gen-1' }) },
    );
    expect(response.status).toBe(204);
    expect(jobEngine.deleteGeneration).toHaveBeenCalledWith(
      'gen-1',
      { confirmUnknownOutcome: false },
      expect.anything(),
    );
  });

  it('passes explicit unknown-outcome confirmation', async () => {
    const response = await deleteGeneration(
      new Request('http://localhost:3000/api/generations/gen-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmUnknownOutcome: true }),
      }),
      { params: Promise.resolve({ id: 'gen-1' }) },
    );
    expect(response.status).toBe(204);
    expect(jobEngine.deleteGeneration).toHaveBeenCalledWith(
      'gen-1',
      { confirmUnknownOutcome: true },
      expect.anything(),
    );
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
          delivery: 'managed',
          availability: 'available',
          removedAt: null,
        },
      ],
    });

    const response = await cancelGeneration(
      new Request('http://localhost:3000/api/generations/gen-1/cancel', {
        method: 'POST',
        headers: { 'X-Request-Id': 'cancel-request-1' },
      }),
      { params: Promise.resolve({ id: 'gen-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBe('cancel-request-1');
    expect(body.images[0]).toEqual({
      id: 'image-1',
      jobId: 'job-1',
      index: 0,
      url: '/api/images/image-1',
      width: 1024,
      height: 1024,
      favorited: true,
      delivery: 'managed',
      availability: 'available',
      removedAt: null,
    });
  });

  it('returns a correlated structured error without exposing resource details', async () => {
    vi.mocked(jobEngine.cancelGeneration).mockRejectedValue(
      new NotFoundError('Generation not found: secret-generation-id'),
    );

    const response = await cancelGeneration(
      new Request('http://localhost:3000/api/generations/missing/cancel', {
        method: 'POST',
        headers: { 'X-Request-Id': 'cancel-request-2' },
      }),
      { params: Promise.resolve({ id: 'missing' }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('X-Request-Id')).toBe('cancel-request-2');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
        retryable: false,
        requestId: 'cancel-request-2',
      },
    });
  });
});
