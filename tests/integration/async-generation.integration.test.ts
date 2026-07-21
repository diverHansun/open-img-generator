import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createIntegrationDb, createStorageDir } from '../helpers/integration';

process.env.FAL_KEY = 'test-fal-key';
const originalDashscopeApiKey = process.env.DASHSCOPE_API_KEY;
process.env.DASHSCOPE_API_KEY = 'test-dashscope-key';
const originalWorkerEnabled = process.env.JOB_WORKER_ENABLED;
process.env.JOB_WORKER_ENABLED = 'false';

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
    if (originalWorkerEnabled === undefined) delete process.env.JOB_WORKER_ENABLED;
    else process.env.JOB_WORKER_ENABLED = originalWorkerEnabled;
    if (originalDashscopeApiKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalDashscopeApiKey;
  });

  it('creates a durable pending generation and completes across dispatch, poll, and storage', async () => {
    let submitCall = false;
    let statusCall = false;
    const imageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('fake-fal-image'),
    ]);

    global.fetch = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/status') && !statusCall) {
        statusCall = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: 'COMPLETED' }),
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response);
      }
      if (requestUrl.includes('/response')) {
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
      if (requestUrl === 'https://cdn.fal.ai/img1.png') {
        return Promise.resolve(new Response(imageBuffer, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }));
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
          clientRequestId: '987fbc97-4bed-4078-af07-9141ba07c9f3',
          targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
          prompt: 'A cat',
          seed: 42,
          sessionId: 'default-session',
        }),
      }),
    );

    expect(postResponse.status).toBe(202);
    const postBody = await postResponse.json();
    expect(postBody.status).toBe('pending');
    expect(submitCall).toBe(false);

    const dispatchResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    expect((await dispatchResponse.json()).status).toBe('pending');
    expect(submitCall).toBe(true);

    const pollResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    expect((await pollResponse.json()).status).toBe('running');

    const getResponse = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${postBody.id}`),
      { params: Promise.resolve({ id: postBody.id }) },
    );
    const getBody = await getResponse.json();
    expect(getBody.status).toBe('completed');
    expect(getBody.images).toHaveLength(1);
    expect(statusCall).toBe(true);
  });

  it('completes Wan 2.7 across multimodal async submit, poll, and storage', async () => {
    const imageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('fake-wan-image'),
    ]);

    global.fetch = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/services/aigc/image-generation/generation')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          model: 'wan2.7-image-pro',
          input: {
            messages: [{
              role: 'user',
              content: [{ text: 'A Wan cup' }],
            }],
          },
          parameters: {
            n: 1,
            enable_sequential: false,
            thinking_mode: false,
          },
        });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            output: { task_id: 'wan-task-1', task_status: 'PENDING' },
          }),
        } as Response);
      }
      if (requestUrl.endsWith('/tasks/wan-task-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            output: {
              task_id: 'wan-task-1',
              task_status: 'SUCCEEDED',
              choices: [{
                message: {
                  content: [{
                    type: 'image',
                    image: 'https://dashscope.example.test/wan.png',
                  }],
                },
              }],
            },
          }),
        } as Response);
      }
      if (requestUrl === 'https://dashscope.example.test/wan.png') {
        return Promise.resolve(new Response(imageBuffer, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }));
      }
      throw new Error(`Unexpected integration request: ${requestUrl}`);
    });

    const postResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: '35bca6c7-7c6f-4c9a-aa61-333333333333',
          targets: [{ provider: 'qwen', model: 'wan2.7-image-pro' }],
          prompt: 'A Wan cup',
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
