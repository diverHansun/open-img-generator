import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './api-client';

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

    await expect(client.submitGeneration({ prompt: 'A cat', targets: [], sessionId: 'session-1' })).rejects.toEqual(
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
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/generations/gen%2F1/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
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
});
