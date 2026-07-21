import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZenmuxProvider } from './zenmux';
import { makeNormalizedRequest } from '../../../../tests/factories';
import { SYNC_IMAGE_GENERATION_TIMEOUT_MS } from '../timeout-policy';

describe('ZenmuxProvider', () => {
  let provider: ZenmuxProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new ZenmuxProvider();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(response: Partial<Response>) {
    global.fetch = vi.fn().mockResolvedValue(response as Response);
  }

  it('submits sync job and returns images', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
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
    expect(timeout).toHaveBeenCalledWith(SYNC_IMAGE_GENERATION_TIMEOUT_MS);
  });

  it('normalizes ZenMux Base64 responses as data URLs', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        created: 123,
        output_format: 'webp',
        data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'A warm mug' }],
      }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'openai/gpt-image-2');

    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.images[0]?.url).toBe('data:image/webp;base64,aGVsbG8=');
      expect(result.images[0]?.contentType).toBe('image/webp');
    }
  });

  it('returns failed on HTTP error', async () => {
    mockFetch({
      ok: false,
      status: 422,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        request_id: 'zenmux-req-1',
        error: { type: 'invalid_params', message: 'Invalid prompt' },
      }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'openai/gpt-image-2');

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(result.error.message).toContain('Invalid prompt');
      expect(result.error.diagnostic).toEqual({
        providerId: 'zenmux',
        category: 'input_invalid',
        providerCode: 'invalid_params',
        providerRequestId: 'zenmux-req-1',
      });
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

  it('uses the selected GPT Image model and allowlists provider options', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });

    await provider.submit(
      makeNormalizedRequest({
        providerOptions: {
          quality: 'medium',
          output_format: 'png',
          model: 'ignored',
          prompt: 'ignored',
          arbitrary: 'ignored',
        },
      }),
      'openai/gpt-image-1.5',
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt: 'A cat wearing a space helmet',
      model: 'openai/gpt-image-1.5',
      n: 1,
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
    });
  });

  it('rejects unknown models before sending a request', async () => {
    global.fetch = vi.fn();

    const result = await provider.submit(makeNormalizedRequest(), 'openai/not-real');

    expect(result).toMatchObject({
      kind: 'failed',
      error: { code: 'INVALID_REQUEST', disposition: 'not_started' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses the Vertex generateContent dialect for Nano Banana models', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        candidates: [{
          content: {
            parts: [
              { text: 'generated' },
              { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
            ],
          },
        }],
      }),
    });

    const result = await provider.submit(
      makeNormalizedRequest({
        aspectRatio: '16:9',
        providerOptions: { imageSize: '2K', arbitrary: 'ignored' },
      }),
      'google/gemini-3.1-flash-image',
    );

    expect(result).toMatchObject({
      kind: 'sync',
      images: [{ url: 'data:image/png;base64,aGVsbG8=', index: 0 }],
    });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models/gemini-3.1-flash-image:generateContent',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'A cat wearing a space helmet' }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
      },
    });
  });

  it('defaults unsupported Gemini image sizes without forwarding arbitrary options', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/webp', data: 'aA==' } }] } }],
      }),
    });

    await provider.submit(
      makeNormalizedRequest({ providerOptions: { imageSize: '8K', quality: 'high' } }),
      'google/gemini-2.5-flash-image',
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.imageConfig.imageSize).toBe('1K');
    expect(JSON.stringify(body)).not.toContain('quality');
  });
});
