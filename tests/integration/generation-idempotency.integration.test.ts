import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIntegrationDb } from '../helpers/integration';

const originalFalKey = process.env.FAL_KEY;
const originalWorkerEnabled = process.env.JOB_WORKER_ENABLED;
process.env.FAL_KEY = 'test-fal-key';
process.env.JOB_WORKER_ENABLED = 'false';

const { cleanup: cleanupDb } = createIntegrationDb();
const { POST: postGeneration } = await import('../../src/app/api/generations/route');

function request(
  clientRequestId: string,
  prompt = 'A quiet reading room',
): Request {
  return new Request('http://localhost:3000/api/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': clientRequestId,
    },
    body: JSON.stringify({
      clientRequestId,
      sessionId: 'default-session',
      prompt,
      targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
    }),
  });
}

function installAsyncFalSubmit() {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      request_id: 'request-idempotency',
      status_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/request-idempotency/status',
      response_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/request-idempotency/response',
      cancel_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/request-idempotency/cancel',
    }),
  } as Response);
  global.fetch = fetch;
  return fetch;
}

describe('generation idempotent admission', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    cleanupDb();
    if (originalFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalFalKey;
    if (originalWorkerEnabled === undefined) delete process.env.JOB_WORKER_ENABLED;
    else process.env.JOB_WORKER_ENABLED = originalWorkerEnabled;
  });

  it('returns the same generation for a response replay and dispatches Fal once', async () => {
    const fetch = installAsyncFalSubmit();
    const clientRequestId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

    const first = await postGeneration(request(clientRequestId));
    const firstBody = await first.json();
    const replay = await postGeneration(request(clientRequestId));
    const replayBody = await replay.json();

    expect(first.status).toBe(201);
    expect(firstBody).toMatchObject({ replayed: false, status: 'pending' });
    expect(replay.status).toBe(201);
    expect(replayBody).toMatchObject({
      id: firstBody.id,
      replayed: true,
      status: 'pending',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('returns a safe conflict for a same-key changed payload without redispatching', async () => {
    const fetch = installAsyncFalSubmit();
    const clientRequestId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    const first = await postGeneration(request(clientRequestId, 'A first scene'));
    const conflict = await postGeneration(request(clientRequestId, 'A second scene'));

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: 'IDEMPOTENCY_KEY_REUSED',
        retryable: false,
      },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('admits concurrent equivalent posts as one generation', async () => {
    const fetch = installAsyncFalSubmit();
    const clientRequestId = '987fbc97-4bed-4078-af07-9141ba07c9f3';

    const [first, second] = await Promise.all([
      postGeneration(request(clientRequestId, 'Concurrent scene')),
      postGeneration(request(clientRequestId, 'Concurrent scene')),
    ]);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(firstBody.id).toBe(secondBody.id);
    expect([firstBody.replayed, secondBody.replayed].sort()).toEqual([
      false,
      true,
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
