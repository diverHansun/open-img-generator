import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNormalizedRequest } from '../../../../tests/factories';
import { SiliconFlowProvider } from './siliconflow';
import { SYNC_IMAGE_GENERATION_TIMEOUT_MS } from '../timeout-policy';

describe('SiliconFlowProvider', () => {
  let provider: SiliconFlowProvider;
  const originalFetch = global.fetch;
  const originalKey = process.env.SILICONFLOW_API_KEY;

  beforeEach(() => {
    provider = new SiliconFlowProvider();
    process.env.SILICONFLOW_API_KEY = 'siliconflow-test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env.SILICONFLOW_API_KEY;
    else process.env.SILICONFLOW_API_KEY = originalKey;
  });

  function mockFetch(payload: unknown, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad Request',
      json: async () => payload,
    } as Response);
  }

  it('submits a sync Z-Image request and parses image metadata', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({ images: [{ url: 'https://cdn.siliconflow.cn/result.png' }], seed: 123 });

    const result = await provider.submit(
      makeNormalizedRequest({
        width: undefined,
        height: undefined,
        aspectRatio: '9:16',
        negativePrompt: 'blurry',
        seed: 123,
      }),
      'Tongyi-MAI/Z-Image',
    );

    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.images).toEqual([
        {
          source: 'remote',
          url: 'https://cdn.siliconflow.cn/result.png',
          width: 720,
          height: 1280,
          contentType: 'image/png',
          index: 0,
        },
      ]);
    }

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe('https://api.siliconflow.cn/v1/images/generations');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer siliconflow-test-key',
    );
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'Tongyi-MAI/Z-Image',
      prompt: 'A cat wearing a space helmet',
      image_size: '720x1280',
      negative_prompt: 'blurry',
      seed: 123,
    });
    expect(timeout).toHaveBeenCalledWith(SYNC_IMAGE_GENERATION_TIMEOUT_MS);
  });

  it('passes non-reserved provider options through', async () => {
    mockFetch({ images: [{ url: 'https://cdn.siliconflow.cn/result.png' }] });

    await provider.submit(
      makeNormalizedRequest({ providerOptions: { guidance_scale: 7, model: 'ignored' } }),
      'Tongyi-MAI/Z-Image',
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toMatchObject({ guidance_scale: 7 });
    expect(JSON.parse(init?.body as string).model).toBe('Tongyi-MAI/Z-Image');
  });

  it('maps provider HTTP errors and missing images', async () => {
    mockFetch({ message: 'invalid image size' }, 422);
    const invalid = await provider.submit(makeNormalizedRequest(), 'Tongyi-MAI/Z-Image');
    expect(invalid.kind).toBe('failed');
    if (invalid.kind === 'failed') {
      expect(invalid.error.code).toBe('INVALID_REQUEST');
      expect(invalid.error.message).toContain('invalid image size');
      expect(invalid.error.diagnostic).toMatchObject({
        providerId: 'siliconflow',
        category: 'input_invalid',
      });
    }

    mockFetch({ images: [] });
    const empty = await provider.submit(makeNormalizedRequest(), 'Tongyi-MAI/Z-Image');
    expect(empty.kind).toBe('failed');

    mockFetch({ message: 'bad request' }, 400);
    const badRequest = await provider.submit(makeNormalizedRequest(), 'Tongyi-MAI/Z-Image');
    expect(badRequest.kind).toBe('failed');
    if (badRequest.kind === 'failed') {
      expect(badRequest.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('maps a timeout to a retryable TIMEOUT error', async () => {
    const timeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    global.fetch = vi.fn().mockRejectedValue(timeout);

    const result = await provider.submit(makeNormalizedRequest(), 'Tongyi-MAI/Z-Image');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('TIMEOUT');
      expect(result.error.retryable).toBe(true);
    }
  });

  it.each([
    [401, 'Invalid token', 'AUTH_FAILED', false],
    [429, { message: 'rate limited' }, 'RATE_LIMITED', true],
    [503, { code: 50505, message: 'service overloaded' }, 'PROVIDER_ERROR', true],
  ])('maps HTTP %s with the correct retry policy', async (status, payload, code, retryable) => {
    mockFetch(payload, status);

    const result = await provider.submit(makeNormalizedRequest(), 'Tongyi-MAI/Z-Image');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe(code);
      expect(result.error.retryable).toBe(retryable);
    }
  });

  it('treats ambiguous transport failures as retryable TIMEOUT outcomes', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('socket closed'));

    const result = await provider.submit(makeNormalizedRequest(), 'Tongyi-MAI/Z-Image');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('TIMEOUT');
      expect(result.error.retryable).toBe(true);
      expect(result.error.disposition).toBe('unknown');
    }
  });

  it.each(['Tongyi-MAI/Z-Image-Turbo', 'baidu/ERNIE-Image-Turbo'])(
    'does not send batch_size to %s',
    async (model) => {
      mockFetch({ images: [{ url: 'https://cdn.siliconflow.cn/result.png' }] });

      const result = await provider.submit(makeNormalizedRequest(), model);

      expect(result.kind).toBe('sync');
      const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model, image_size: '1024x1024' });
      expect(body).not.toHaveProperty('batch_size');
    },
  );

  it('rejects unknown models before sending a request', async () => {
    global.fetch = vi.fn();

    const result = await provider.submit(makeNormalizedRequest(), 'unknown/model');

    expect(result).toMatchObject({
      kind: 'failed',
      error: { code: 'INVALID_REQUEST', disposition: 'not_started' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
