import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalProvider } from './fal';
import { makeNormalizedRequest, makeJobHandle } from '../../../../tests/factories';

describe('FalProvider', () => {
  let provider: FalProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new FalProvider();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(response: Partial<Response>) {
    global.fetch = vi.fn().mockResolvedValue(response as Response);
  }

  it('submits async job and returns handle', async () => {
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
});
