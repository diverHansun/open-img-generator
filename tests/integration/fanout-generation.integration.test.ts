import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntegrationDb, createStorageDir } from '../helpers/integration';

process.env.FAL_KEY = 'test-fal-key';
process.env.ZENMUX_API_KEY = 'test-zenmux-key';
const originalWorkerEnabled = process.env.JOB_WORKER_ENABLED;
process.env.JOB_WORKER_ENABLED = 'false';

const { cleanup: cleanupDb } = createIntegrationDb();
const { cleanup: cleanupStorage } = createStorageDir();

const { POST: postGeneration } = await import('../../src/app/api/generations/route');
const { GET: getGeneration } = await import('../../src/app/api/generations/[id]/route');

describe('fan-out generation (Fal + ZenMux)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    cleanupDb();
    cleanupStorage();
    if (originalWorkerEnabled === undefined) delete process.env.JOB_WORKER_ENABLED;
    else process.env.JOB_WORKER_ENABLED = originalWorkerEnabled;
  });

  it('submits independent jobs, omits ZenMux seed, and aggregates both results', async () => {
    const imageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('fanout-image'),
    ]);
    let falRequest: Record<string, unknown> | undefined;
    let zenmuxRequest: Record<string, unknown> | undefined;

    global.fetch = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/status')) {
        return Promise.resolve(jsonResponse({ status: 'COMPLETED' }));
      }
      if (requestUrl.includes('/response')) {
        return Promise.resolve(jsonResponse({
          images: [{ url: 'https://cdn.fal.ai/fal.png', width: 1024, height: 1024, content_type: 'image/png' }],
        }));
      }
      if (requestUrl.includes('cdn.')) {
        return Promise.resolve(binaryResponse(imageBuffer));
      }
      if (requestUrl.includes('queue.fal.run')) {
        falRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(jsonResponse({
          request_id: 'req-fal',
          status_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-fal/status',
          response_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-fal/response',
          cancel_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-fal/cancel',
        }));
      }
      zenmuxRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(jsonResponse({
        created: 123,
        data: [{ url: 'https://cdn.zenmux.ai/zenmux.png' }],
      }));
    });

    const postResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: '123e4567-e89b-42d3-a456-426614174000',
          prompt: 'A calm reading room',
          targets: [
            { provider: 'fal', model: 'fal-ai/flux/schnell' },
            { provider: 'zenmux', model: 'openai/gpt-image-2' },
          ],
          aspectRatio: '1:1',
          count: 1,
          seed: 42,
          sessionId: 'default-session',
        }),
      }),
    );

    expect(postResponse.status).toBe(202);
    const postBody = await postResponse.json();
    expect(postBody.status).toBe('pending');
    expect(falRequest).toBeUndefined();
    expect(zenmuxRequest).toBeUndefined();

    const dispatchResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    expect((await dispatchResponse.json()).status).toBe('running');
    expect(falRequest).toMatchObject({ seed: 42, image_size: 'square_hd' });
    expect(zenmuxRequest).not.toHaveProperty('seed');

    const pollResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    expect((await pollResponse.json()).status).toBe('running');

    const getResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const view = await getResponse.json();
    expect(view.status).toBe('completed');
    expect(view.jobs).toHaveLength(2);
    expect(view.jobs.map((job: { status: string }) => job.status).sort()).toEqual(['completed', 'completed']);
    expect(view.images).toHaveLength(2);
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
  } as Response;
}

function binaryResponse(buffer: Buffer): Response {
  const body = new Uint8Array(buffer.byteLength);
  body.set(buffer);
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}
