import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeJobHandle, makeNormalizedRequest } from '../../../../tests/factories';
import { QwenProvider } from './qwen';

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
    model: 'qwen-image-plus',
    externalId: 'task-1',
    statusUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks/task-1',
    responseUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks/task-1',
    cancelUrl: null,
  };

  it('submits an async Qwen task with DashScope headers and nested body', async () => {
    mockFetch({ output: { task_id: 'task-1', task_status: 'PENDING' } });

    const result = await provider.submit(
      makeNormalizedRequest({ aspectRatio: '16:9', negativePrompt: 'blurry', seed: 7 }),
      'qwen-image-plus',
    );

    expect(result.kind).toBe('async');
    if (result.kind === 'async') {
      expect(result.handle.externalId).toBe('task-1');
      expect(result.handle.statusUrl).toBe(
        'https://dashscope.aliyuncs.com/api/v1/tasks/task-1',
      );
      expect(result.handle.cancelUrl).toBeNull();
    }

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer dashscope-test-key',
    );
    expect((init?.headers as Record<string, string>)['X-DashScope-Async']).toBe('enable');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'qwen-image-plus',
      input: { prompt: 'A cat wearing a space helmet' },
      parameters: {
        size: '1664*928',
        n: 1,
        negative_prompt: 'blurry',
        seed: 7,
      },
    });
  });

  it('polls pending, running, completed, and cancelled states', async () => {
    mockFetch({ output: { task_id: 'task-1', task_status: 'PENDING' } });
    expect((await provider.poll(handle)).status).toBe('pending');

    mockFetch({ output: { task_id: 'task-1', task_status: 'RUNNING' } });
    expect((await provider.poll(handle)).status).toBe('running');

    mockFetch({
      output: {
        task_id: 'task-1',
        task_status: 'SUCCEEDED',
        results: [{ url: 'https://cdn.example.com/qwen.png', size: '1664*928', actual_prompt: 'expanded' }],
      },
    });
    const completed = await provider.poll(handle);
    expect(completed.status).toBe('completed');
    if (completed.status === 'completed') {
      expect(completed.images[0]).toMatchObject({
        url: 'https://cdn.example.com/qwen.png',
        width: 1664,
        height: 928,
        revisedPrompt: 'expanded',
      });
    }

    mockFetch({ output: { task_id: 'task-1', task_status: 'CANCELED' } });
    expect((await provider.poll(handle)).status).toBe('cancelled');
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
    if (failed.status === 'failed') expect(failed.error.code).toBe('INVALID_REQUEST');

    mockFetch({ code: 'InvalidApiKey', message: 'No API-key provided.' }, 401);
    const auth = await provider.submit(makeNormalizedRequest(), 'qwen-image-plus');
    expect(auth.kind).toBe('failed');
    if (auth.kind === 'failed') expect(auth.error.code).toBe('AUTH_FAILED');

    mockFetch({ code: 'Throttled', message: 'Too many requests' }, 429);
    const throttled = await provider.submit(makeNormalizedRequest(), 'qwen-image-plus');
    expect(throttled.kind).toBe('failed');
    if (throttled.kind === 'failed') {
      expect(throttled.error.code).toBe('RATE_LIMITED');
      expect(throttled.error.retryable).toBe(true);
    }

    const timeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    global.fetch = vi.fn().mockRejectedValue(timeout);
    const timedOut = await provider.submit(makeNormalizedRequest(), 'qwen-image-plus');
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

    const result = await provider.submit(makeNormalizedRequest(), 'qwen-image-plus');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error).toMatchObject({
        code: 'UNKNOWN',
        retryable: true,
        disposition: 'unknown',
      });
    }
  });
});
