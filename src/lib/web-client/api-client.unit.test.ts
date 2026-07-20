import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './api-client';

const CLIENT_REQUEST_ID = '15a6fecc-4f40-4ed2-8f51-353423be9af1';

describe('web API client', () => {
  it('reads backend health through the same typed client as generation calls', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'ok', enabledProviders: ['fal'], db: 'ok' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createApiClient(fetcher as typeof fetch);

    await expect(client.getHealth()).resolves.toEqual({
      status: 'ok',
      enabledProviders: ['fal'],
      db: 'ok',
    });
    expect(fetcher).toHaveBeenCalledWith('/api/health', undefined);
  });

  it('preserves API validation messages for the workbench error state', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unsupported aspect ratio' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient(fetcher as typeof fetch);

    await expect(client.submitGeneration({
      clientRequestId: CLIENT_REQUEST_ID,
      prompt: 'A cat',
      targets: [],
      sessionId: 'session-1',
    })).rejects.toEqual(
      new ApiClientError('Unsupported aspect ratio', 400),
    );
  });

  it('uses code and retryability from structured API errors without breaking legacy errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'CREDENTIAL_MANAGED_BY_ENV',
            message: 'This credential is environment-owned.',
            retryable: false,
          },
        }),
        { status: 409, statusText: 'Conflict' },
      ),
    );
    const client = createApiClient(fetcher as typeof fetch);

    await expect(client.saveProviderCredential('fal', 'draft-secret')).rejects.toEqual(
      new ApiClientError(
        'This credential is environment-owned.',
        409,
        'CREDENTIAL_MANAGED_BY_ENV',
        false,
      ),
    );
  });

  it('prefers a valid body request ID and parses delta-seconds Retry-After', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Please wait.',
            retryable: true,
            requestId: 'body-request-1',
          },
        }),
        {
          status: 429,
          headers: {
            'X-Request-Id': 'header-request-2',
            'Retry-After': '9',
          },
        },
      ),
    );
    const client = createApiClient(fetcher as typeof fetch);

    await expect(
      client.submitGeneration({
        clientRequestId: CLIENT_REQUEST_ID,
        prompt: 'A cat',
        targets: [],
        sessionId: 'session-1',
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      requestId: 'body-request-1',
      retryAfterMs: 9_000,
    });
  });

  it('sends the durable client request id in both body and Idempotency-Key', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'generation-1',
          status: 'pending',
          replayed: false,
          links: { self: '/api/generations/generation-1' },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createApiClient(fetcher as typeof fetch);

    await expect(
      client.submitGeneration({
        clientRequestId: CLIENT_REQUEST_ID,
        prompt: 'A cat',
        targets: [],
        sessionId: 'session-1',
      }),
    ).resolves.toMatchObject({ id: 'generation-1', replayed: false });

    expect(fetcher).toHaveBeenCalledWith('/api/generations', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': CLIENT_REQUEST_ID,
      },
      body: JSON.stringify({
        clientRequestId: CLIENT_REQUEST_ID,
        prompt: 'A cat',
        targets: [],
        sessionId: 'session-1',
      }),
      signal: expect.any(AbortSignal),
    }));
  });

  it('aborts a generation detail request after its deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );
    const client = createApiClient(fetcher as typeof fetch);
    const request = client.getGenerationById('generation-1');
    const rejection = expect(request).rejects.toThrow('aborted');

    try {
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to a safe header request ID and caps HTTP-date Retry-After', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Unavailable',
            retryable: true,
            requestId: 'contains spaces',
          },
        }),
        {
          status: 503,
          headers: {
            'X-Request-Id': 'safe-header-id',
            'Retry-After': 'Mon, 20 Jul 2026 00:30:00 GMT',
          },
        },
      ),
    );
    const client = createApiClient(fetcher as typeof fetch);

    try {
      await expect(client.getHealth()).rejects.toMatchObject({
        requestId: 'safe-header-id',
        retryAfterMs: 300_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores invalid request and Retry-After headers for legacy errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Bad request' }), {
        status: 400,
        headers: {
          'X-Request-Id': 'bad header',
          'Retry-After': 'later',
        },
      }),
    );
    const client = createApiClient(fetcher as typeof fetch);

    await expect(client.getHealth()).rejects.toMatchObject({
      message: 'Bad request',
      requestId: undefined,
      retryAfterMs: undefined,
    });
  });

  it('preserves structured authentication errors for project deletion', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required',
            retryable: false,
          },
        }),
        { status: 401, statusText: 'Unauthorized' },
      ),
    );
    const client = createApiClient(fetcher as typeof fetch);

    await expect(client.deleteProject('project/one')).rejects.toEqual(
      new ApiClientError('Authentication required', 401, 'AUTHENTICATION_REQUIRED', false),
    );
    expect(fetcher).toHaveBeenCalledWith('/api/projects/project%2Fone', {
      method: 'DELETE',
    });
  });

  it('encodes project-scoped sessions and read-only history queries', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const client = createApiClient(fetcher as typeof fetch);

    await client.listSessions('project/one');
    await client.listGenerations({ sessionId: 'session one', limit: 10 });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/projects/project%2Fone/sessions',
      undefined,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/generations?sessionId=session+one&limit=10',
      undefined,
    );
  });

  it('wires auth bootstrap and generation cancellation without changing list semantics', async () => {
    const view = {
      id: 'gen-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      prompt: 'A cat',
      status: 'cancelled',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
      jobs: [],
      images: [],
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(view), { status: 200 }));
    const client = createApiClient(fetcher as typeof fetch);

    await expect(client.getAuthSession()).resolves.toEqual({ authenticated: true });
    await expect(client.cancelGeneration('gen/1')).resolves.toEqual(view);
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/generations/gen%2F1/cancel', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: expect.any(AbortSignal),
    }));
  });

  it('encodes the new workspace, History, Gallery and Provider contract methods', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'session-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ groups: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const client = createApiClient(fetcher as typeof fetch);

    await client.listProjectSummaries();
    await client.ensureInitialSession('project/one');
    await client.getProjectHistory('project/one', {
      page: 2,
      sessionLimit: 5,
      generationLimit: 10,
    });
    await client.listFavorites({
      projectId: 'project one',
      provider: 'qwen',
      cursor: 'next cursor',
      sort: 'newest',
    });
    await client.listProviderConfigurations();

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/project-summaries', undefined);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project%2Fone/sessions/initial',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      '/api/projects/project%2Fone/history?page=2&sessionLimit=5&generationLimit=10',
      undefined,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      '/api/favorites?projectId=project+one&provider=qwen&cursor=next+cursor&sort=newest',
      undefined,
    );
    expect(fetcher).toHaveBeenNthCalledWith(5, '/api/provider-configurations', undefined);
  });

  it('forwards AbortSignal through every page-level read', async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient(fetcher as typeof fetch);
    const signal = new AbortController().signal;

    await client.getAuthSession({ signal });
    await client.getHealth({ signal });
    await client.listProviders({ signal });
    await client.getGeneration('/api/generations/gen-1', { signal });
    await client.getGenerationById('gen/1', { signal });
    await client.listGenerations({ projectId: 'project one' }, { signal });
    await client.listProjects({ signal });
    await client.listProjectSummaries({ signal });
    await client.getProject('project/one', { signal });
    await client.listSessions('project/one', { signal });
    await client.getSession('session/one', { signal });
    await client.getProjectHistory('project/one', {}, { signal });
    await client.listFavorites({}, { signal });
    await client.listModelPreferences({ signal });
    await client.listProviderConfigurations({ signal });

    expect(fetcher).toHaveBeenCalledTimes(15);
    for (const [index, [, init]] of fetcher.mock.calls.entries()) {
      if (index === 3 || index === 4) {
        expect(init).toEqual({ signal: expect.any(AbortSignal) });
      } else {
        expect(init).toEqual({ signal });
      }
    }
  });
});
