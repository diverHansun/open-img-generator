import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getJson,
  parseRetryAfter,
  postJson,
  ProviderHttpError,
  putJson,
} from './http-client';

describe('provider HTTP boundary', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses delta and HTTP-date Retry-After values with a hard cap', () => {
    const now = Date.parse('2026-07-20T00:00:00.000Z');
    expect(parseRetryAfter('2.5', now)).toBe(2_500);
    expect(parseRetryAfter('Mon, 20 Jul 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('999999', now)).toBe(60_000);
    expect(parseRetryAfter('invalid', now)).toBeUndefined();
  });

  it('does not enter fetch when a caller signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = vi.fn();

    await expect(postJson('https://provider.example/submit', {}, {}, {
      signal: controller.signal,
    })).rejects.toMatchObject({
      name: 'ProviderHttpError',
      disposition: 'not_started',
      retryable: true,
    } satisfies Partial<ProviderHttpError>);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not enter fetch after the caller deadline elapsed', async () => {
    global.fetch = vi.fn();

    await expect(getJson('https://provider.example/status', {}, {
      deadlineAt: Date.now() - 1,
    })).rejects.toMatchObject({
      name: 'ProviderHttpError',
      disposition: 'not_started',
    } satisfies Partial<ProviderHttpError>);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('composes a non-aborted caller signal without AbortSignal.any', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    const controller = new AbortController();
    try {
      Object.defineProperty(AbortSignal, 'any', {
        configurable: true,
        value: undefined,
      });
      global.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          expect(signal).toBeInstanceOf(AbortSignal);
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      );
      const request = getJson('https://provider.example/status', {}, {
        signal: controller.signal,
      });
      const rejection = expect(request).rejects.toMatchObject({
        disposition: 'unknown',
        retryable: true,
      } satisfies Partial<ProviderHttpError>);
      controller.abort();
      await rejection;
      expect(global.fetch).toHaveBeenCalledOnce();
    } finally {
      if (descriptor) Object.defineProperty(AbortSignal, 'any', descriptor);
      else Reflect.deleteProperty(AbortSignal, 'any');
    }
  });

  it('classifies 429 as a rejected retryable response with Retry-After', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'slow down' }),
      { status: 429, headers: { 'Retry-After': '3' } },
    ));

    await expect(getJson('https://provider.example/status', {})).rejects.toMatchObject({
      status: 429,
      disposition: 'rejected',
      retryable: true,
      retryAfterMs: 3_000,
    } satisfies Partial<ProviderHttpError>);
  });

  it('keeps started transport failures and 5xx responses ambiguous', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection reset'));
    await expect(postJson('https://provider.example/submit', {}, {})).rejects.toMatchObject({
      disposition: 'unknown',
      retryable: true,
    } satisfies Partial<ProviderHttpError>);

    global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(postJson('https://provider.example/submit', {}, {})).rejects.toMatchObject({
      status: 503,
      disposition: 'unknown',
      retryable: true,
    } satisfies Partial<ProviderHttpError>);
  });

  it('keeps an unreadable successful response ambiguous instead of treating it as JSON null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        throw new Error('truncated response');
      },
    } as unknown as Response);

    await expect(postJson('https://provider.example/submit', {}, {})).rejects.toMatchObject({
      status: 200,
      disposition: 'unknown',
      retryable: true,
      body: null,
    } satisfies Partial<ProviderHttpError>);
  });

  it('does not treat an empty successful submit response as a confirmed result', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 204,
      headers: { 'content-length': '0' },
    }));

    await expect(postJson('https://provider.example/submit', {}, {})).rejects.toMatchObject({
      disposition: 'unknown',
      retryable: true,
    } satisfies Partial<ProviderHttpError>);
  });

  it('allows an explicitly empty response only for a bodyless cancellation verb', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 204,
      headers: { 'content-length': '0' },
    }));

    await expect(putJson('https://provider.example/cancel', {})).resolves.toBeNull();
  });
});
