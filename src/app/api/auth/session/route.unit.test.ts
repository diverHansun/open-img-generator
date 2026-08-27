import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from './route';

describe('/api/auth/session', () => {
  const originalToken = process.env.APP_AUTH_TOKEN;

  beforeEach(() => {
    process.env.APP_AUTH_TOKEN = 'local-secret';
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.APP_AUTH_TOKEN;
    else process.env.APP_AUTH_TOKEN = originalToken;
  });

  it('sets a strict HttpOnly cookie for a valid token', async () => {
    const response = await POST(
      new Request('http://localhost/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'local-secret' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('open_image_generator_auth=local-secret');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=strict');
  });

  it('reports cookie/header authentication through the public bootstrap GET', async () => {
    await expect((await GET(new Request('http://localhost/api/auth/session'))).json()).resolves.toEqual({ authenticated: false });
    await expect((await GET(new Request('http://localhost/api/auth/session', {
      headers: { authorization: 'Bearer local-secret' },
    }))).json()).resolves.toEqual({ authenticated: true });
  });

  it('rejects an invalid token and clears the cookie on logout', async () => {
    const invalid = await POST(
      new Request('http://localhost/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'wrong' }),
      }),
    );
    expect(invalid.status).toBe(401);

    const cleared = DELETE();
    expect(cleared.status).toBe(200);
    expect(cleared.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
