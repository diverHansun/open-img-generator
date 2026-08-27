import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeJobHandle, makeNormalizedRequest } from '../../../../tests/factories';
import { QwenProvider } from './qwen';
import { SYNC_IMAGE_GENERATION_TIMEOUT_MS } from '../timeout-policy';

describe('QwenProvider', () => {
  let provider: QwenProvider;
  const originalFetch = global.fetch;
  const originalEnv = {
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL,
  };

  beforeEach(() => {
    provider = new QwenProvider();
    process.env.DASHSCOPE_API_KEY = 'dashscope-test-key';
    delete process.env.DASHSCOPE_BASE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalEnv.apiKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalEnv.apiKey;
    if (originalEnv.baseUrl === undefined) delete process.env.DASHSCOPE_BASE_URL;
    else process.env.DASHSCOPE_BASE_URL = originalEnv.baseUrl;
  });

  function mockFetch(payload: unknown, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad Request',
      json: async () => payload,
    } as Response);
  }

  const handle = {
    ...makeJobHandle(),
    providerId: 'qwen' as const,
    model: 'wan2.7-image-pro',
    externalId: 'task-1',
    statusUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks/task-1',
    responseUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks/task-1',
    cancelUrl: null,
  };

  it('advertises Qwen batch limits supported by the API', () => {
    expect(provider.capabilities.has('qwen-image-plus')).toBe(false);
    expect(provider.capabilities.get('qwen-image-3.0-pro')?.maxCount).toBe(6);
    expect(provider.capabilities.get('qwen-image-3.0')?.maxCount).toBe(6);
    expect(provider.capabilities.get('qwen-image-2.0-pro-2026-06-22')?.maxCount).toBe(6);
    expect(provider.capabilities.get('qwen-image-2.0-pro')?.maxCount).toBe(6);
    expect(provider.capabilities.get('wan2.7-image')?.maxCount).toBe(4);
    expect(provider.capabilities.get('wan2.7-image-pro')?.maxCount).toBe(4);
    for (const model of [
      'qwen-image-3.0-pro',
      'qwen-image-3.0',
      'qwen-image-2.0-pro-2026-06-22',
      'qwen-image-2.0-pro',
      'wan2.7-image',
    ]) {
      expect(provider.capabilities.get(model)?.modes).toEqual(['text-to-image']);
    }
  });

  it('submits Qwen Image 3.0 Pro synchronously with the Qwen multimodal body', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({
      output: {
        choices: [{
          message: {
            role: 'assistant',
            content: [{ type: 'image', image: 'https://oss.example.com/qwen3-pro.png' }],
          },
        }],
      },
    });

    const result = await provider.submit(
      makeNormalizedRequest({ aspectRatio: '16:9', negativePrompt: 'blurry', seed: 7 }),
      'qwen-image-3.0-pro',
    );

    expect(result).toMatchObject({
      kind: 'sync',
      images: [{ url: 'https://oss.example.com/qwen3-pro.png', index: 0 }],
    });

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer dashscope-test-key',
    );
    expect((init?.headers as Record<string, string>)['X-DashScope-Async']).toBeUndefined();
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'qwen-image-3.0-pro',
      input: {
        messages: [{
          role: 'user',
          content: [{ text: 'A cat wearing a space helmet' }],
        }],
      },
      parameters: {
        size: '1280*720',
        n: 1,
        watermark: false,
        prompt_extend: true,
        negative_prompt: 'blurry',
        seed: 7,
      },
    });
    expect(timeout).toHaveBeenCalledWith(SYNC_IMAGE_GENERATION_TIMEOUT_MS);
  });

  it('submits Qwen Image 2.0 Pro synchronously with multimodal text content', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({
      output: {
        choices: [{
          message: {
            role: 'assistant',
            content: [{ type: 'image', image: 'https://oss.example.com/qwen2.png' }],
          },
        }],
      },
    });

    const result = await provider.submit(
      makeNormalizedRequest({
        aspectRatio: '1:1',
        negativePrompt: 'blurry',
        seed: 9,
      }),
      'qwen-image-2.0-pro',
    );

    expect(result).toMatchObject({
      kind: 'sync',
      images: [{ url: 'https://oss.example.com/qwen2.png', index: 0 }],
    });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect((init?.headers as Record<string, string>)['X-DashScope-Async']).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'qwen-image-2.0-pro',
      input: {
        messages: [{
          role: 'user',
          content: [{ text: 'A cat wearing a space helmet' }],
        }],
      },
      parameters: {
        size: '1024*1024',
        n: 1,
        watermark: false,
        seed: 9,
        prompt_extend: true,
        negative_prompt: 'blurry',
      },
    });
    expect(timeout).toHaveBeenCalledWith(SYNC_IMAGE_GENERATION_TIMEOUT_MS);
  });

  it.each([
    ['qwen-image-3.0', 'qwen3.png'],
    ['qwen-image-2.0-pro-2026-06-22', 'qwen2-snapshot.png'],
  ])('submits %s through the Qwen sync profile', async (model, imageName) => {
    mockFetch({
      output: {
        choices: [{
          message: {
            content: [{ type: 'image', image: 'https://oss.example.com/' + imageName }],
          },
        }],
      },
    });

    const result = await provider.submit(makeNormalizedRequest(), model);

    expect(result).toMatchObject({
      kind: 'sync',
      images: [{ url: 'https://oss.example.com/' + imageName, index: 0 }],
    });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect((init?.headers as Record<string, string>)['X-DashScope-Async']).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model,
      input: {
        messages: [{
          role: 'user',
          content: [{ text: 'A cat wearing a space helmet' }],
        }],
      },
    });
  });

  it('submits Wan 2.7 through the async multimodal endpoint', async () => {
    mockFetch({ output: { task_id: 'wan-task-1', task_status: 'PENDING' } });

    const result = await provider.submit(
      makeNormalizedRequest({ aspectRatio: '16:9', count: 4, seed: 23 }),
      'wan2.7-image-pro',
    );

    expect(result).toMatchObject({
      kind: 'async',
      handle: { externalId: 'wan-task-1', model: 'wan2.7-image-pro' },
    });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation',
    );
    expect((init?.headers as Record<string, string>)['X-DashScope-Async']).toBe('enable');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'wan2.7-image-pro',
      input: {
        messages: [{
          role: 'user',
          content: [{ text: 'A cat wearing a space helmet' }],
        }],
      },
      parameters: {
        size: '1280*720',
        n: 4,
        watermark: false,
        seed: 23,
        enable_sequential: false,
        thinking_mode: false,
      },
    });
  });

  it('submits standard Wan 2.7 synchronously with Wan-only parameters', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({
      output: {
        choices: [{
          message: {
            role: 'assistant',
            content: [{ type: 'image', image: 'https://oss.example.com/wan-standard.png' }],
          },
        }],
      },
    });

    const result = await provider.submit(
      makeNormalizedRequest({ aspectRatio: '1:1', count: 4, seed: 23, negativePrompt: 'ignored' }),
      'wan2.7-image',
    );

    expect(result).toMatchObject({
      kind: 'sync',
      images: [{ url: 'https://oss.example.com/wan-standard.png', index: 0 }],
    });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect((init?.headers as Record<string, string>)['X-DashScope-Async']).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'wan2.7-image',
      input: {
        messages: [{
          role: 'user',
          content: [{ text: 'A cat wearing a space helmet' }],
        }],
      },
      parameters: {
        size: '1024*1024',
        n: 4,
        watermark: false,
        seed: 23,
        enable_sequential: false,
        thinking_mode: true,
      },
    });
    expect(timeout).toHaveBeenCalledWith(SYNC_IMAGE_GENERATION_TIMEOUT_MS);
  });

  it('polls Wan multimodal choices into image references', async () => {
    mockFetch({
      output: {
        task_id: 'wan-task-1',
        task_status: 'SUCCEEDED',
        choices: [{
          message: {
            role: 'assistant',
            content: [{ type: 'image', image: 'https://oss.example.com/wan.png' }],
          },
        }],
      },
    });

    const result = await provider.poll({
      ...handle,
      model: 'wan2.7-image-pro',
      externalId: 'wan-task-1',
    });

    expect(result).toMatchObject({
      status: 'completed',
      images: [{ url: 'https://oss.example.com/wan.png', index: 0 }],
    });
  });

  it('polls pending, running, completed, and cancelled states', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetch({ output: { task_id: 'task-1', task_status: 'PENDING' } });
    expect((await provider.poll(handle)).status).toBe('pending');

    mockFetch({ output: { task_id: 'task-1', task_status: 'RUNNING' } });
    expect((await provider.poll(handle)).status).toBe('running');

    mockFetch({
      output: {
        task_id: 'task-1',
        task_status: 'SUCCEEDED',
        choices: [{
          message: {
            content: [{ type: 'image', image: 'https://cdn.example.com/wan.png' }],
          },
        }],
      },
    });
    const completed = await provider.poll(handle);
    expect(completed.status).toBe('completed');
    if (completed.status === 'completed') {
      expect(completed.images[0]).toMatchObject({
        url: 'https://cdn.example.com/wan.png',
        width: null,
        height: null,
      });
    }

    mockFetch({ output: { task_id: 'task-1', task_status: 'CANCELED' } });
    expect((await provider.poll(handle)).status).toBe('cancelled');
    expect(timeout).toHaveBeenCalledWith(15_000);
  });

  it('rebuilds a poll endpoint from the configured base and encoded task ID', async () => {
    mockFetch({ output: { task_id: 'task/../?opaque', task_status: 'PENDING' } });

    const result = await provider.poll({
      ...handle,
      externalId: 'task/../?opaque',
      statusUrl: 'https://attacker.example/collect',
      responseUrl: 'https://attacker.example/collect',
    });

    expect(result.status).toBe('pending');
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/tasks/task%2F..%2F%3Fopaque',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer dashscope-test-key',
    );
  });

  it('rejects a dot-only persisted task ID before sending its credential', async () => {
    global.fetch = vi.fn();

    const result = await provider.poll({ ...handle, externalId: '..' });

    expect(result.status).toBe('failed');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps task failures, HTTP errors, and timeouts', async () => {
    mockFetch({
      output: { task_id: 'task-1', task_status: 'FAILED', code: 'InvalidParameter', message: 'bad size' },
    });
    const failed = await provider.poll(handle);
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') {
      expect(failed.error.code).toBe('INVALID_REQUEST');
      expect(failed.error.diagnostic).toMatchObject({
        providerId: 'qwen',
        category: 'input_invalid',
        providerCode: 'InvalidParameter',
      });
    }

    mockFetch({ code: 'InvalidApiKey', message: 'No API-key provided.' }, 401);
    const auth = await provider.submit(makeNormalizedRequest(), 'qwen-image-3.0-pro');
    expect(auth.kind).toBe('failed');
    if (auth.kind === 'failed') expect(auth.error.code).toBe('AUTH_FAILED');

    mockFetch({ code: 'Throttled', message: 'Too many requests' }, 429);
    const throttled = await provider.submit(makeNormalizedRequest(), 'qwen-image-3.0-pro');
    expect(throttled.kind).toBe('failed');
    if (throttled.kind === 'failed') {
      expect(throttled.error.code).toBe('RATE_LIMITED');
      expect(throttled.error.retryable).toBe(true);
    }

    const timeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    global.fetch = vi.fn().mockRejectedValue(timeout);
    const timedOut = await provider.submit(makeNormalizedRequest(), 'qwen-image-3.0-pro');
    expect(timedOut.kind).toBe('failed');
    if (timedOut.kind === 'failed') {
      expect(timedOut.error.code).toBe('TIMEOUT');
      expect(timedOut.error.retryable).toBe(true);
    }
  });

  it('keeps an unreadable successful submit response ambiguous', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        throw new Error('truncated response');
      },
    } as unknown as Response);

    const result = await provider.submit(makeNormalizedRequest(), 'qwen-image-3.0-pro');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error).toMatchObject({
        code: 'UNKNOWN',
        retryable: true,
        disposition: 'unknown',
      });
    }
  });

  it('rejects unknown models before sending a request', async () => {
    global.fetch = vi.fn();

    const result = await provider.submit(makeNormalizedRequest(), 'qwen-not-real');

    expect(result).toMatchObject({
      kind: 'failed',
      error: { code: 'INVALID_REQUEST', disposition: 'not_started' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects the removed Qwen Image Plus model before sending a request', async () => {
    global.fetch = vi.fn();

    const result = await provider.submit(makeNormalizedRequest(), 'qwen-image-plus');

    expect(result).toMatchObject({
      kind: 'failed',
      error: { code: 'INVALID_REQUEST', disposition: 'not_started' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
