import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createIntegrationDb, createStorageDir } from '../helpers/integration';

process.env.ZENMUX_API_KEY = 'test-zenmux-key';

const { tempFile, cleanup: cleanupDb } = createIntegrationDb();
const { tempDir, cleanup: cleanupStorage } = createStorageDir();

const { POST: postGeneration } = await import('../../src/app/api/generations/route');
const { GET: getGeneration } = await import('../../src/app/api/generations/[id]/route');
const { GET: getImage } = await import('../../src/app/api/images/[id]/route');

describe('sync generation end-to-end (zenmux)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    cleanupDb();
    cleanupStorage();
  });

  it('creates, completes and serves image in one POST', async () => {
    const imageBuffer = Buffer.from('fake-image-bytes');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        created: 123,
        data: [{ url: 'https://cdn.zenmux.ai/img1.png', revised_prompt: 'A cat' }],
      }),
      arrayBuffer: async () => imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength),
    } as unknown as Response);

    const postResponse = await postGeneration(
      new Request('http://localhost:3000/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'zenmux',
          model: 'openai/gpt-image-2',
          prompt: 'A cat',
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
