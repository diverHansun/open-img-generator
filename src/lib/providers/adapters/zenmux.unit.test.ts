import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZenmuxProvider } from './zenmux';
import { makeNormalizedRequest } from '../../../../tests/factories';

describe('ZenmuxProvider', () => {
  let provider: ZenmuxProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new ZenmuxProvider();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(response: Partial<Response>) {
    global.fetch = vi.fn().mockResolvedValue(response as Response);
  }

  it('submits sync job and returns images', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        created: 123,
        data: [
          {
            url: 'https://cdn.zenmux.ai/img1.png',
            revised_prompt: 'A cat in a space helmet',
          },
        ],
      }),
    });

    const result = await provider.submit(
      makeNormalizedRequest({ width: 1024, height: 1024 }),
      'openai/gpt-image-2',
    );

    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.images).toHaveLength(1);
      expect(result.images[0].url).toBe('https://cdn.zenmux.ai/img1.png');
      expect(result.images[0].revisedPrompt).toBe('A cat in a space helmet');
    }

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.size).toBe('1024x1024');
    expect(body.n).toBe(1);
  });

  it('returns failed on HTTP error', async () => {
    mockFetch({
      ok: false,
      status: 422,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { message: 'Invalid prompt' },
      }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'openai/gpt-image-2');

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(result.error.message).toContain('Invalid prompt');
    }
  });

  it('returns failed when response has no images', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ created: 123, data: [] }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'openai/gpt-image-2');
    expect(result.kind).toBe('failed');
  });

  it('maps aspectRatio to OpenAI size string', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        created: 123,
        data: [{ url: 'https://cdn.zenmux.ai/img1.png' }],
      }),
    });

    await provider.submit(
      makeNormalizedRequest({ aspectRatio: '3:2', width: undefined, height: undefined }),
      'openai/gpt-image-2',
    );

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.size).toBe('1536x1024');
  });
});
