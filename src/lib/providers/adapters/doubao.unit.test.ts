import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNormalizedRequest } from '../../../../tests/factories';
import { DoubaoProvider } from './doubao';
import { SYNC_IMAGE_GENERATION_TIMEOUT_MS } from '../timeout-policy';

describe('DoubaoProvider', () => {
  let provider: DoubaoProvider;
  const originalFetch = global.fetch;
  const originalEnv = {
    apiKey: process.env.ARK_API_KEY,
    baseUrl: process.env.ARK_BASE_URL,
  };

  beforeEach(() => {
    provider = new DoubaoProvider();
    process.env.ARK_API_KEY = 'ark-test-key';
    delete process.env.ARK_BASE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalEnv.apiKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = originalEnv.apiKey;
    if (originalEnv.baseUrl === undefined) delete process.env.ARK_BASE_URL;
    else process.env.ARK_BASE_URL = originalEnv.baseUrl;
  });

  function mockFetch(payload: unknown, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad Request',
      json: async () => payload,
    } as Response);
  }

  it('submits Seedream and parses image metadata', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({
      model: 'doubao-seedream-4-0-250828',
      data: [{ url: 'https://cdn.volcengine.com/result.jpg', size: '2048x1536' }],
    });

    const result = await provider.submit(
      makeNormalizedRequest({ aspectRatio: '4:3', seed: 42 }),
      'doubao-seedream-4-0-250828',
    );

    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.images[0]).toMatchObject({
        url: 'https://cdn.volcengine.com/result.jpg',
        width: 2048,
        height: 1536,
        contentType: 'image/jpeg',
      });
    }

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer ark-test-key',
    );
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'doubao-seedream-4-0-250828',
      prompt: 'A cat wearing a space helmet',
      size: '2048x1536',
      seed: 42,
      sequential_image_generation: 'disabled',
      response_format: 'b64_json',
    });
    expect(timeout).toHaveBeenCalledWith(SYNC_IMAGE_GENERATION_TIMEOUT_MS);
  });

  it('passes reference images and non-reserved options', async () => {
    mockFetch({ data: [{ b64_json: 'aGVsbG8=', size: '2K' }] });

    await provider.submit(
      makeNormalizedRequest({
        referenceImages: ['https://example.com/ref.png'],
        providerOptions: { guidance_scale: 6, model: 'ignored' },
      }),
      'doubao-seedream-4-0-250828',
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string);
    expect(body.image).toEqual(['https://example.com/ref.png']);
    expect(body.guidance_scale).toBe(6);
    expect(body.model).toBe('doubao-seedream-4-0-250828');
  });

  it.each([
    [400, { error: { code: 'InvalidParameter', message: 'invalid prompt' } }, 'INVALID_REQUEST', false],
    [401, { message: 'invalid token' }, 'AUTH_FAILED', false],
    [429, { message: 'quota exceeded' }, 'RATE_LIMITED', true],
    [503, { message: 'service unavailable' }, 'PROVIDER_ERROR', true],
  ])('maps HTTP %s errors', async (status, payload, code, retryable) => {
    mockFetch(payload, status);

    const result = await provider.submit(makeNormalizedRequest(), 'doubao-seedream-4-0-250828');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe(code);
      expect(result.error.retryable).toBe(retryable);
      if (status === 400) {
        expect(result.error.diagnostic).toMatchObject({
          providerId: 'doubao',
          category: 'input_invalid',
          providerCode: 'InvalidParameter',
        });
      }
    }
  });
});
