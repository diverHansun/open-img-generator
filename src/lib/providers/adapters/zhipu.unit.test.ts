import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNormalizedRequest } from '../../../../tests/factories';
import { ZhipuProvider } from './zhipu';
import { SYNC_IMAGE_GENERATION_TIMEOUT_MS } from '../timeout-policy';

describe('ZhipuProvider', () => {
  let provider: ZhipuProvider;
  const originalFetch = global.fetch;
  const originalEnv = {
    apiKey: process.env.ZHIPU_API_KEY,
    userId: process.env.ZHIPU_USER_ID,
  };

  beforeEach(() => {
    provider = new ZhipuProvider();
    process.env.ZHIPU_API_KEY = 'zhipu-test-key';
    process.env.ZHIPU_USER_ID = 'local-test-user';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalEnv.apiKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = originalEnv.apiKey;
    if (originalEnv.userId === undefined) delete process.env.ZHIPU_USER_ID;
    else process.env.ZHIPU_USER_ID = originalEnv.userId;
  });

  function mockFetch(payload: unknown, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad Request',
      json: async () => payload,
    } as Response);
  }

  it('submits glm-image with official size and parses data URLs', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({
      created: 1720000000,
      data: [{ url: 'https://cdn.bigmodel.cn/result.png' }],
      content_filter: [{ role: 0, level: 0 }],
    });

    const result = await provider.submit(
      makeNormalizedRequest({ width: undefined, height: undefined, aspectRatio: '3:2' }),
      'glm-image',
    );

    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.images[0]).toMatchObject({
        url: 'https://cdn.bigmodel.cn/result.png',
        width: 1568,
        height: 1056,
        contentType: 'image/png',
        index: 0,
      });
    }

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/images/generations');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer zhipu-test-key',
    );
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'glm-image',
      prompt: 'A cat wearing a space helmet',
      quality: 'hd',
      size: '1568x1056',
      watermark_enabled: true,
      user_id: 'local-test-user',
    });
    expect(timeout).toHaveBeenCalledWith(SYNC_IMAGE_GENERATION_TIMEOUT_MS);
  });

  it('passes non-reserved provider options without allowing canonical overrides', async () => {
    mockFetch({ data: [{ url: 'https://cdn.bigmodel.cn/result.png' }] });

    await provider.submit(
      makeNormalizedRequest({
        providerOptions: {
          watermark_enabled: false,
          negative_prompt: 'ignored',
          seed: 123,
          guidance_scale: 6,
        },
      }),
      'glm-image',
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'glm-image',
      watermark_enabled: true,
      guidance_scale: 6,
    });
    expect(JSON.parse(init?.body as string).negative_prompt).toBeUndefined();
    expect(JSON.parse(init?.body as string).seed).toBeUndefined();
  });

  it('maps provider errors and empty data responses', async () => {
    mockFetch({ error: { code: '1210', message: 'invalid prompt' } }, 422);
    const invalid = await provider.submit(makeNormalizedRequest(), 'glm-image');
    expect(invalid.kind).toBe('failed');
    if (invalid.kind === 'failed') {
      expect(invalid.error.code).toBe('INVALID_REQUEST');
      expect(invalid.error.message).toContain('invalid prompt');
      expect(invalid.error.diagnostic).toMatchObject({
        providerId: 'zhipu',
        category: 'input_invalid',
        providerCode: '1210',
      });
    }

    mockFetch({ created: 1720000000, data: [] });
    const empty = await provider.submit(makeNormalizedRequest(), 'glm-image');
    expect(empty.kind).toBe('failed');
  });

  it('maps a timeout to a retryable TIMEOUT error', async () => {
    const timeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    global.fetch = vi.fn().mockRejectedValue(timeout);

    const result = await provider.submit(makeNormalizedRequest(), 'glm-image');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('TIMEOUT');
      expect(result.error.retryable).toBe(true);
    }
  });

  it.each([
    [401, { error: { code: '401', message: 'invalid token' } }, 'AUTH_FAILED', false],
    [429, { error: { code: '429', message: 'rate limited' } }, 'RATE_LIMITED', true],
    [503, { error: { code: '503', message: 'service unavailable' } }, 'PROVIDER_ERROR', true],
  ])('maps HTTP %s with the correct retry policy', async (status, payload, code, retryable) => {
    mockFetch(payload, status);

    const result = await provider.submit(makeNormalizedRequest(), 'glm-image');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe(code);
      expect(result.error.retryable).toBe(retryable);
    }
  });

  it('rejects unknown models before sending a request', async () => {
    global.fetch = vi.fn();

    const result = await provider.submit(makeNormalizedRequest(), 'glm-not-real');

    expect(result).toMatchObject({
      kind: 'failed',
      error: { code: 'INVALID_REQUEST', disposition: 'not_started' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
