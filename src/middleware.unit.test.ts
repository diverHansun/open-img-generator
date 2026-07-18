import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

describe('API authentication middleware', () => {
  const originalToken = process.env.APP_AUTH_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.APP_AUTH_TOKEN;
    else process.env.APP_AUTH_TOKEN = originalToken;
  });

  it('uses the structured error contract for unauthenticated API requests', async () => {
    process.env.APP_AUTH_TOKEN = 'test-token';

    const response = middleware(
      new NextRequest('http://localhost:3000/api/project-summaries'),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        retryable: false,
      },
    });
  });
});
