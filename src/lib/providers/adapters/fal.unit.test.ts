import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalProvider } from './fal';
import { makeNormalizedRequest, makeJobHandle } from '../../../../tests/factories';

describe('FalProvider', () => {
  let provider: FalProvider;
  const originalFetch = global.fetch;
  const originalEnv = {
    apiKey: process.env.FAL_KEY,
    baseUrl: process.env.FAL_BASE_URL,
  };

  beforeEach(() => {
    provider = new FalProvider();
    process.env.FAL_KEY = 'fal-test-key';
    process.env.FAL_BASE_URL = 'https://queue.fal.run';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalEnv.apiKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalEnv.apiKey;
    if (originalEnv.baseUrl === undefined) delete process.env.FAL_BASE_URL;
    else process.env.FAL_BASE_URL = originalEnv.baseUrl;
  });

  function mockFetch(response: Partial<Response>) {
    global.fetch = vi.fn().mockResolvedValue(response as Response);
  }

  it('submits async job and returns handle', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        request_id: 'req-1',
        status_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/status',
        response_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/response',
        cancel_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/cancel',
      }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'fal-ai/flux/schnell');

    expect(result.kind).toBe('async');
    if (result.kind === 'async') {
      expect(result.handle.externalId).toBe('req-1');
      expect(result.handle.statusUrl).toContain('/status');
    }
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it('maps public aspect ratios to Fal image_size values', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        request_id: 'req-1',
        status_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/status',
        response_url: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/response',
      }),
    });

    await provider.submit(
      makeNormalizedRequest({ aspectRatio: '16:9' }),
      'fal-ai/flux/schnell',
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({ image_size: 'landscape_16_9' });
  });

  it.each([
    ['fal-ai/nano-banana-2', '16:9'],
    ['fal-ai/nano-banana-pro', '3:2'],
  ])('uses Banana request fields for %s', async (model, aspectRatio) => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        request_id: 'banana-req-1',
        status_url: `https://queue.fal.run/${model}/requests/banana-req-1/status`,
        response_url: `https://queue.fal.run/${model}/requests/banana-req-1/response`,
      }),
    });

    const result = await provider.submit(
      makeNormalizedRequest({
        aspectRatio,
        seed: 17,
        providerOptions: {
          resolution: '1K',
          output_format: 'webp',
          safety_tolerance: '3',
          sync_mode: true,
          enable_web_search: true,
          image_size: 'ignored',
        },
      }),
      model,
    );

    expect(result.kind).toBe('async');
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(`https://queue.fal.run/${model}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt: 'A cat wearing a space helmet',
      num_images: 1,
      aspect_ratio: aspectRatio,
      resolution: '1K',
      output_format: 'webp',
      limit_generations: true,
      seed: 17,
      safety_tolerance: '3',
    });
  });

  it('uses the documented per-model Banana defaults', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        request_id: 'banana-req-2',
        status_url: 'https://queue.fal.run/fal-ai/nano-banana-2/requests/banana-req-2/status',
        response_url: 'https://queue.fal.run/fal-ai/nano-banana-2/requests/banana-req-2/response',
      }),
    });

    await provider.submit(makeNormalizedRequest(), 'fal-ai/nano-banana-2');
    let [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      aspect_ratio: 'auto',
      resolution: '1K',
    });

    vi.mocked(global.fetch).mockClear();
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        request_id: 'banana-req-3',
        status_url: 'https://queue.fal.run/fal-ai/nano-banana-pro/requests/banana-req-3/status',
        response_url: 'https://queue.fal.run/fal-ai/nano-banana-pro/requests/banana-req-3/response',
      }),
    });
    await provider.submit(makeNormalizedRequest(), 'fal-ai/nano-banana-pro');
    [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      aspect_ratio: '1:1',
      resolution: '1K',
    });
  });

  it('does not persist attacker-controlled task endpoints from a submit response', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        request_id: 'req-1',
        status_url: 'https://attacker.example/collect',
        response_url: 'https://queue.fal.run/requests/req-1/response',
      }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'fal-ai/flux/schnell');

    expect(result).toMatchObject({
      kind: 'failed',
      error: { code: 'PROVIDER_ERROR', disposition: 'unknown' },
    });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('rejects a model path containing dot segments before sending its credential', async () => {
    global.fetch = vi.fn();

    const result = await provider.submit(makeNormalizedRequest(), 'fal-ai/../requests');

    expect(result).toMatchObject({ kind: 'failed' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns failed on HTTP error', async () => {
    mockFetch({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'Unauthorized' }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'fal-ai/flux/schnell');

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('AUTH_FAILED');
      expect(result.error.httpStatus).toBe(401);
    }
  });

  it('maps documented Fal error types and preserves only a safe request id', async () => {
    mockFetch({
      ok: false,
      status: 422,
      headers: new Headers({
        'content-type': 'application/json',
        'x-fal-request-id': 'fal-req-123',
      }),
      json: async () => ({
        detail: [{ type: 'content_policy_violation', input: 'private prompt' }],
      }),
    });

    const result = await provider.submit(makeNormalizedRequest(), 'fal-ai/flux/schnell');

    expect(result).toMatchObject({
      kind: 'failed',
      error: {
        diagnostic: {
          providerId: 'fal',
          category: 'content_policy',
          providerCode: 'content_policy_violation',
          providerRequestId: 'fal-req-123',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private prompt');
  });

  it('polls pending status', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'IN_QUEUE' }),
    });

    const result = await provider.poll(makeJobHandle());
    expect(result.status).toBe('pending');
  });

  it('polls running status', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'IN_PROGRESS' }),
    });

    const result = await provider.poll(makeJobHandle());
    expect(result.status).toBe('running');
  });

  it('polls completed and fetches images', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      const response =
        callCount === 1
          ? { status: 'COMPLETED' }
          : {
              images: [
                {
                  url: 'https://cdn.fal.ai/img1.png',
                  width: 1024,
                  height: 1024,
                  content_type: 'image/png',
                },
              ],
            };
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => response,
      } as Response);
    });

    const result = await provider.poll(makeJobHandle());

    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.images).toHaveLength(1);
      expect(result.images[0].url).toBe('https://cdn.fal.ai/img1.png');
      expect(result.images[0].index).toBe(0);
    }
  });

  it('returns failed on poll HTTP error', async () => {
    mockFetch({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'Internal error' }),
    });

    const result = await provider.poll(makeJobHandle());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.code).toBe('PROVIDER_ERROR');
    }
  });

  it('does not send its credential to a poisoned persisted task URL', async () => {
    global.fetch = vi.fn();

    const result = await provider.poll(makeJobHandle({
      statusUrl: 'https://attacker.example/collect',
    }));

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_REQUEST' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('cancels via cancelUrl', async () => {
    mockFetch({
      ok: true,
      status: 202,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    });

    const result = await provider.cancel(makeJobHandle());
    expect(result.status).toBe('cancelled');

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[1]?.method).toBe('PUT');
  });

  it('rejects unknown models before sending a request', async () => {
    global.fetch = vi.fn();

    const result = await provider.submit(makeNormalizedRequest(), 'fal-ai/not-real');

    expect(result).toMatchObject({
      kind: 'failed',
      error: { code: 'INVALID_REQUEST', disposition: 'not_started' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
