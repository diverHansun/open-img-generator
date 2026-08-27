import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAuthorizedRequest } from './auth';
import { isAuthorizedEdgeRequest } from './auth-edge';

describe('single-user auth', () => {
  const originalToken = process.env.APP_AUTH_TOKEN;

  beforeEach(() => {
    process.env.APP_AUTH_TOKEN = 'local-secret';
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.APP_AUTH_TOKEN;
    else process.env.APP_AUTH_TOKEN = originalToken;
  });

  it.each([
    ['Bearer local-secret', true],
    ['bearer local-secret', true],
    ['Bearer wrong', false],
    ['', false],
  ])('authorizes bearer header %s', (authorization, expected) => {
    const request = new Request('http://localhost/api/providers', {
      headers: authorization ? { authorization } : undefined,
    });
    expect(isAuthorizedRequest(request)).toBe(expected);
    expect(isAuthorizedEdgeRequest(request)).toBe(expected);
  });

  it('accepts the HttpOnly cookie and rejects malformed encoding', () => {
    expect(
      isAuthorizedRequest(
        new Request('http://localhost/api/providers', {
          headers: { cookie: 'open_image_generator_auth=local-secret' },
        }),
      ),
    ).toBe(true);
    expect(
      isAuthorizedEdgeRequest(
        new Request('http://localhost/api/providers', {
          headers: { cookie: 'open_image_generator_auth=%E0%A4%A' },
        }),
      ),
    ).toBe(false);
  });

  it('allows all requests when the token is not configured', () => {
    delete process.env.APP_AUTH_TOKEN;
    expect(isAuthorizedRequest(new Request('http://localhost/api/providers'))).toBe(true);
    expect(isAuthorizedEdgeRequest(new Request('http://localhost/api/providers'))).toBe(true);
  });
});
