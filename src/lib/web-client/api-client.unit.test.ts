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
});
