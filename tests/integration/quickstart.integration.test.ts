import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createIntegrationDb, createStorageDir } from '../helpers/integration';

process.env.FAL_KEY = 'test-fal-key';
process.env.ZENMUX_API_KEY = 'test-zenmux-key';

const { tempFile, cleanup: cleanupDb } = createIntegrationDb();
const { tempDir, cleanup: cleanupStorage } = createStorageDir();

const { GET: getHealth } = await import('../../src/app/api/health/route');
const { GET: getProviders } = await import('../../src/app/api/providers/route');
const { POST: postProject } = await import('../../src/app/api/projects/route');
const { POST: postSession } = await import(
  '../../src/app/api/projects/[id]/sessions/route'
);
const { GET: getSession } = await import('../../src/app/api/sessions/[id]/route');
const { POST: postGeneration } = await import('../../src/app/api/generations/route');
const { GET: getGeneration } = await import(
  '../../src/app/api/generations/[id]/route'
);

const originalFetch = global.fetch;

describe('quickstart vertical slice', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    cleanupDb();
    cleanupStorage();
  });

  it('matches the quickstart.md flows', async () => {
    // 1. Health check
    const health = await getHealth();
    expect(health.status).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.status).toBe('ok');
    expect(healthBody.enabledProviders.sort()).toEqual(['fal', 'zenmux']);

    // 2. Providers list
    const providers = await getProviders();
    const providersBody = await providers.json();
    expect(providersBody.map((p: { id: string }) => p.id).sort()).toEqual([
      'fal',
      'zenmux',
    ]);

    // 3. Create project and a project-scoped session
    const projectResponse = await postProject(
      new Request('http://localhost:3000/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Quickstart' }),
      }),
    );
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json();

    const sessionResponse = await postSession(
      new Request(`http://localhost:3000/api/projects/${project.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'demo' }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(sessionResponse.status).toBe(201);
    const session = await sessionResponse.json();
    expect(session.title).toBe('demo');

    // 4. Sync generation (zenmux)
    const imageBuffer = Buffer.from('quickstart-sync-image');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        created: 123,
        data: [{ url: 'https://cdn.zenmux.ai/cat.png' }],
      }),
      arrayBuffer: async () =>
        imageBuffer.buffer.slice(
          imageBuffer.byteOffset,
          imageBuffer.byteOffset + imageBuffer.byteLength,
        ),
    } as unknown as Response);

    const syncResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ provider: 'zenmux', model: 'openai/gpt-image-2' }],
          prompt: 'A cat wearing a space helmet',
          aspectRatio: '1:1',
          sessionId: session.id,
        }),
      }),
    );
    expect(syncResponse.status).toBe(201);
    const syncBody = await syncResponse.json();
    expect(syncBody.status).toBe('completed');
    expect(syncBody.links.self).toMatch(/^\/api\/generations\//);

    // 5. Async generation with sessionId (fal)
    let statusCalled = false;
    const falImageBuffer = Buffer.from('quickstart-async-image');
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        statusCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: 'COMPLETED' }),
        } as Response);
      }
      if (url.includes('/response')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            images: [
              {
                url: 'https://cdn.fal.ai/dog.png',
                width: 1024,
                height: 1024,
                content_type: 'image/png',
              },
            ],
          }),
        } as Response);
      }
      if (url.includes('cdn.fal.ai')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/png' }),
          arrayBuffer: async () =>
            falImageBuffer.buffer.slice(
              falImageBuffer.byteOffset,
              falImageBuffer.byteOffset + falImageBuffer.byteLength,
            ),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          request_id: 'req-quickstart',
          status_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-quickstart/status',
          response_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-quickstart/response',
          cancel_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-quickstart/cancel',
        }),
      } as Response);
    });

    const asyncResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
          prompt: 'A dog',
          seed: 42,
          sessionId: session.id,
        }),
      }),
    );
    expect(asyncResponse.status).toBe(201);
    const asyncBody = await asyncResponse.json();
    expect(asyncBody.status).toBe('pending');
    expect(asyncBody.links.self).toMatch(/^\/api\/generations\//);

    // Client poll
    const polled = await getGeneration(
      new Request(`http://localhost:3000/api/generations/${asyncBody.id}`),
      { params: Promise.resolve({ id: asyncBody.id }) },
    );
    const polledBody = await polled.json();
    expect(polledBody.status).toBe('completed');
    expect(statusCalled).toBe(true);

    // 6. This listing is read-only; the generation GET above advanced it.
    const sessionDetail = await getSession(
      new Request(`http://localhost:3000/api/sessions/${session.id}?include=generations`),
      { params: Promise.resolve({ id: session.id }) },
    );
    const sessionDetailBody = await sessionDetail.json();
    expect(sessionDetailBody.generations).toHaveLength(2);
    expect(sessionDetailBody.generations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
      ]),
    );
  });

  it('rejects the retired top-level provider/model request shape', async () => {
    const response = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'fal',
          model: 'fal-ai/flux/schnell',
          prompt: 'A cat',
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'At least one target is required' });
  });
});
