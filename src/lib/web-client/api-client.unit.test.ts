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

    await expect(client.submitGeneration({ prompt: 'A cat', targets: [] })).rejects.toEqual(
      new ApiClientError('Unsupported aspect ratio', 400),
    );
  });
});
