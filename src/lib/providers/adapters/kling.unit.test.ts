import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNormalizedRequest } from '../../../../tests/factories';
import { KlingProvider } from './kling';

describe('KlingProvider', () => {
  let provider: KlingProvider;
  const originalFetch = global.fetch;
  const originalEnv = {
    apiKey: process.env.KLING_API_KEY,
    baseUrl: process.env.KLING_BASE_URL,
  };

  beforeEach(() => {
    provider = new KlingProvider();
    process.env.KLING_API_KEY = 'kling-test-key';
    process.env.KLING_BASE_URL = 'https://kling.example.test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalEnv.apiKey === undefined) delete process.env.KLING_API_KEY;
    else process.env.KLING_API_KEY = originalEnv.apiKey;
    if (originalEnv.baseUrl === undefined) delete process.env.KLING_BASE_URL;
    else process.env.KLING_BASE_URL = originalEnv.baseUrl;
  });

  function mockFetch(payload: unknown, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad Request',
      json: async () => payload,
    } as Response);
  }

  it('submits through the standalone Kling API and strips data URL prefixes', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({ code: 0, data: { task_id: 'kling-task-1' } });

    const result = await provider.submit(
      makeNormalizedRequest({
        aspectRatio: '21:9',
        count: 3,
        negativePrompt: 'blurry',
        referenceImages: ['data:image/png;base64,ZmFrZQ=='],
        providerOptions: {
          resolution: '2k',
          image_fidelity: 0.7,
          model_name: 'must-not-override',
        },
      }),
      'kling-v3',
    );

    expect(result.kind).toBe('async');
    if (result.kind === 'async') {
      expect(result.handle.externalId).toBe('kling-task-1');
      expect(result.handle.statusUrl).toBe(
        'https://kling.example.test/v1/images/generations/kling-task-1',
      );
      expect(result.handle.cancelUrl).toBeNull();
    }

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe('https://kling.example.test/v1/images/generations');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer kling-test-key',
    );
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model_name: 'kling-v3',
      prompt: 'A cat wearing a space helmet',
      negative_prompt: 'blurry',
      aspect_ratio: '21:9',
      resolution: '2k',
      n: 3,
      image: 'ZmFrZQ==',
      image_reference: 'subject',
      image_fidelity: 0.7,
    });
    expect(JSON.parse(init?.body as string).model_name).toBe('kling-v3');
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it('polls submitted, processing, success, and failure envelopes', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({ code: 0, data: { task_status: 'submitted' } });
    const handle = {
      providerId: 'kling' as const,
      model: 'kling-v3',
      externalId: 'kling-task-1',
      statusUrl: 'https://kling.example.test/v1/images/generations/kling-task-1',
      responseUrl: 'https://kling.example.test/v1/images/generations/kling-task-1',
      cancelUrl: null,
      submittedAt: new Date().toISOString(),
    };
    expect((await provider.poll(handle)).status).toBe('pending');

    mockFetch({ code: 0, data: { task_status: 'processing' } });
    expect((await provider.poll(handle)).status).toBe('running');

    mockFetch({
      code: 0,
      data: {
        task_status: 'succeed',
        task_result: { images: [{ url: 'https://cdn.example.test/kling.png' }] },
      },
    });
    const completed = await provider.poll(handle);
    expect(completed).toMatchObject({
      status: 'completed',
      images: [{ url: 'https://cdn.example.test/kling.png', index: 0 }],
    });

    mockFetch({ code: '1001', message: 'bad prompt' });
    const failed = await provider.poll(handle);
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') {
      expect(failed.error.diagnostic).toMatchObject({
        providerId: 'kling',
        category: 'authentication',
        providerCode: '1001',
      });
    }
    expect(timeout).toHaveBeenCalledWith(15_000);
  });

  it('rebuilds a poll endpoint from the configured base and encoded task ID', async () => {
    mockFetch({ code: 0, data: { task_status: 'submitted' } });

    const result = await provider.poll({
      providerId: 'kling',
      model: 'kling-v3',
      externalId: 'kling/../?opaque',
      statusUrl: 'https://attacker.example/collect',
      responseUrl: 'https://attacker.example/collect',
      cancelUrl: null,
      submittedAt: new Date().toISOString(),
    });

    expect(result.status).toBe('pending');
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://kling.example.test/v1/images/generations/kling%2F..%2F%3Fopaque',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer kling-test-key',
    );
  });

  it('rejects a dot-only persisted task ID before sending its credential', async () => {
    global.fetch = vi.fn();

    const result = await provider.poll({
      providerId: 'kling',
      model: 'kling-v3',
      externalId: '..',
      statusUrl: 'https://attacker.example/collect',
      responseUrl: 'https://attacker.example/collect',
      cancelUrl: null,
      submittedAt: new Date().toISOString(),
    });

    expect(result.status).toBe('failed');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects more than one reference image for the standard endpoint', async () => {
    const result = await provider.submit(
      makeNormalizedRequest({ referenceImages: ['a', 'b'] }),
      'kling-v3',
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.message).toContain('at most one reference image');
    }
  });
});
