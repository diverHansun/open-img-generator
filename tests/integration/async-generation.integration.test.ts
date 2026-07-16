import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createIntegrationDb, createStorageDir } from '../helpers/integration';

process.env.FAL_KEY = 'test-fal-key';

const { tempFile, cleanup: cleanupDb } = createIntegrationDb();
const { tempDir, cleanup: cleanupStorage } = createStorageDir();

const { POST: postGeneration } = await import('../../src/app/api/generations/route');
const { GET: getGeneration } = await import('../../src/app/api/generations/[id]/route');

describe('async generation end-to-end (fal)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    cleanupDb();
    cleanupStorage();
  });

  it('creates pending generation and completes on GET poll', async () => {
    let submitCall = false;
    let statusCall = false;
    const imageBuffer = Buffer.from('fake-fal-image');

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/status') && !statusCall) {
        statusCall = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: 'COMPLETED' }),
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response);
      }
      if (typeof url === 'string' && url.includes('/response')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            images: [{ url: 'https://cdn.fal.ai/img1.png', width: 1024, height: 1024, content_type: 'image/png' }],
          }),
          arrayBuffer: async () => imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength),
        } as Response);
      }
      // submit
      submitCall = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          request_id: 'req-1',
          status_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/status',
          response_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/response',
          cancel_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/cancel',
        }),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response);
    });

    const postResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
          prompt: 'A cat',
          seed: 42,
        }),
      }),
    );

    expect(postResponse.status).toBe(201);
    const postBody = await postResponse.json();
    expect(postBody.status).toBe('pending');
    expect(submitCall).toBe(true);

    const getResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const getBody = await getResponse.json();
    expect(getBody.status).toBe('completed');
    expect(getBody.images).toHaveLength(1);
    expect(statusCall).toBe(true);
  });
});
