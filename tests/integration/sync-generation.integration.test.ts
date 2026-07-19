import { afterAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createIntegrationDb, createStorageDir } from '../helpers/integration';
import { registerMswLifecycle } from '../msw/lifecycle';
import { server } from '../msw/server';

const originalZenmuxApiKey = process.env.ZENMUX_API_KEY;
process.env.ZENMUX_API_KEY = 'test-zenmux-key';

const { tempFile, cleanup: cleanupDb } = createIntegrationDb();
const { tempDir, cleanup: cleanupStorage } = createStorageDir();

const { POST: postGeneration } = await import('../../src/app/api/generations/route');
const { GET: getGeneration } = await import('../../src/app/api/generations/[id]/route');
const { GET: getImage } = await import('../../src/app/api/images/[id]/route');

registerMswLifecycle();

describe('sync generation end-to-end (zenmux)', () => {
  afterAll(() => {
    cleanupDb();
    cleanupStorage();
    if (originalZenmuxApiKey === undefined) delete process.env.ZENMUX_API_KEY;
    else process.env.ZENMUX_API_KEY = originalZenmuxApiKey;
  });

  it('creates, completes and serves image in one POST', async () => {
    const imageBuffer = Buffer.from('fake-image-bytes');
    server.use(
      http.post('https://zenmux.ai/api/v1/images/generations', () =>
        HttpResponse.json({
          created: 123,
          data: [{ url: 'https://cdn.zenmux.ai/img1.png', revised_prompt: 'A cat' }],
        }),
      ),
      http.get(
        'https://cdn.zenmux.ai/img1.png',
        () => new HttpResponse(new Uint8Array(imageBuffer), {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );

    const postResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ provider: 'zenmux', model: 'openai/gpt-image-2' }],
          prompt: 'A cat',
          sessionId: 'default-session',
        }),
      }),
    );

    expect(postResponse.status).toBe(201);
    const postBody = await postResponse.json();
    expect(postBody.status).toBe('completed');

    const getResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const getBody = await getResponse.json();
    expect(getBody.status).toBe('completed');
    expect(getBody.images).toHaveLength(1);

    const imageUrl = getBody.images[0].url;
    const imageId = imageUrl.replace('/api/images/', '');
    const imageResponse = await getImage(
      new Request(`http://localhost:3000/api/images/${imageId}`),
      { params: Promise.resolve({ id: imageId }) },
    );
    expect(imageResponse.status).toBe(200);
  });
});
