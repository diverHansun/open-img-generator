import { afterAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createIntegrationDb, createStorageDir } from '../helpers/integration';
import { registerMswLifecycle } from '../msw/lifecycle';
import { server } from '../msw/server';

const originalZenmuxApiKey = process.env.ZENMUX_API_KEY;
const originalDashscopeApiKey = process.env.DASHSCOPE_API_KEY;
const originalWorkerEnabled = process.env.JOB_WORKER_ENABLED;
process.env.ZENMUX_API_KEY = 'test-zenmux-key';
process.env.DASHSCOPE_API_KEY = 'test-dashscope-key';
process.env.JOB_WORKER_ENABLED = 'false';

const { tempFile, cleanup: cleanupDb } = createIntegrationDb();
const { tempDir, cleanup: cleanupStorage } = createStorageDir();

const { POST: postGeneration } = await import('../../src/app/api/generations/route');
const { GET: getGeneration } = await import('../../src/app/api/generations/[id]/route');
const { GET: getImage } = await import('../../src/app/api/images/[id]/route');
const { POST: postFavorite } = await import('../../src/app/api/favorites/route');
const { db, getGenerationWithJobsAndImages } = await import('../../src/lib/db');

registerMswLifecycle();

describe('sync generation end-to-end (zenmux)', () => {
  afterAll(() => {
    cleanupDb();
    cleanupStorage();
    if (originalZenmuxApiKey === undefined) delete process.env.ZENMUX_API_KEY;
    else process.env.ZENMUX_API_KEY = originalZenmuxApiKey;
    if (originalDashscopeApiKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalDashscopeApiKey;
    if (originalWorkerEnabled === undefined) delete process.env.JOB_WORKER_ENABLED;
    else process.env.JOB_WORKER_ENABLED = originalWorkerEnabled;
  });

  it('durably admits first, then completes through detail-driven lifecycle checkpoints', async () => {
    const imageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('fake-image-bytes'),
    ]);
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
          clientRequestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          targets: [{ provider: 'zenmux', model: 'openai/gpt-image-2' }],
          prompt: 'A cat',
          sessionId: 'default-session',
        }),
      }),
    );

    expect(postResponse.status).toBe(202);
    const postBody = await postResponse.json();
    expect(postBody.status).toBe('pending');

    const dispatchResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    expect((await dispatchResponse.json()).status).toBe('running');

    const getResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const getBody = await getResponse.json();
    expect(getBody.status).toBe('completed');
    expect(getBody.images).toHaveLength(1);
    expect(getBody.images[0].favorited).toBe(false);

    const imageUrl = getBody.images[0].url;
    const imageId = imageUrl.replace('/api/images/', '');
    const favoriteResponse = await postFavorite(
      new Request('http://localhost:3000/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      }),
    );
    expect(favoriteResponse.status).toBe(200);

    const favoriteAwareResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const favoriteAwareBody = await favoriteAwareResponse.json();
    expect(favoriteAwareBody.images[0]).toMatchObject({
      id: imageId,
      favorited: true,
    });

    const imageResponse = await getImage(
      new Request(`http://localhost:3000/api/images/${imageId}`),
      { params: Promise.resolve({ id: imageId }) },
    );
    expect(imageResponse.status).toBe(200);
  });

  it('stages ZenMux b64_json without persisting the data URL in SQLite', async () => {
    const imageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('base64-zenmux-image'),
    ]);
    server.use(
      http.post('https://zenmux.ai/api/v1/images/generations', () =>
        HttpResponse.json({
          created: 456,
          output_format: 'png',
          data: [{ b64_json: imageBuffer.toString('base64') }],
        }),
      ),
    );

    const postResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: '15bca6c7-7c6f-4c9a-aa61-111111111111',
          targets: [{ provider: 'zenmux', model: 'openai/gpt-image-2' }],
          prompt: 'A staged image',
          sessionId: 'default-session',
        }),
      }),
    );
    const postBody = await postResponse.json();

    await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const durable = getGenerationWithJobsAndImages(postBody.id, db)!;
    expect(durable.jobs[0]?.resultSnapshot).toContain('staging:');
    expect(durable.jobs[0]?.resultSnapshot).not.toContain('data:image');
    expect(durable.jobs[0]?.resultSnapshot).not.toContain(imageBuffer.toString('base64'));

    const completedResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const completed = await completedResponse.json();
    expect(completed.status).toBe('completed');
    expect(completed.images).toHaveLength(1);
  });

  it('completes Qwen Image 2.0 through its sync multimodal profile', async () => {
    const imageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('qwen-image-2-integration'),
    ]);
    server.use(
      http.post(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          expect(body).toMatchObject({
            model: 'qwen-image-2.0-pro',
            input: {
              messages: [{
                role: 'user',
                content: [{ text: 'A Qwen cup' }],
              }],
            },
          });
          return HttpResponse.json({
            output: {
              choices: [{
                message: {
                  content: [{
                    type: 'image',
                    image: 'https://dashscope.example.test/qwen2.png',
                  }],
                },
              }],
            },
          });
        },
      ),
      http.get(
        'https://dashscope.example.test/qwen2.png',
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
          clientRequestId: '25bca6c7-7c6f-4c9a-aa61-222222222222',
          targets: [{ provider: 'qwen', model: 'qwen-image-2.0-pro' }],
          prompt: 'A Qwen cup',
          aspectRatio: '1:1',
          sessionId: 'default-session',
        }),
      }),
    );
    const postBody = await postResponse.json();

    await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const completedResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const completed = await completedResponse.json();
    expect(completed.status).toBe('completed');
    expect(completed.images).toHaveLength(1);
  });
});
