import os from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabaseUrl = process.env.DATABASE_URL;

describe('health readiness with an unavailable database', () => {
  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    vi.resetModules();
  });

  it('loads the route and returns a redacted 503 when opening SQLite fails', async () => {
    process.env.DATABASE_URL = os.tmpdir();
    vi.resetModules();

    const { GET } = await import('./route');
    const response = GET(new Request('http://localhost:3000/api/health'));
    const body = await response.json();
    const requestId = response.headers.get('X-Request-Id');

    expect(response.status).toBe(503);
    expect(requestId).toBeTruthy();
    expect(body.error).toEqual({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is unavailable',
      retryable: true,
      requestId,
    });
    expect(JSON.stringify(body)).not.toContain(os.tmpdir());
  });
});
