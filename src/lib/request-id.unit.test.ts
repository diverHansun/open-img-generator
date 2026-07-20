import { describe, expect, it } from 'vitest';

import {
  createRequestId,
  getRequestId,
  isValidRequestId,
  withRequestId,
} from './request-id';

describe('request ID correlation', () => {
  it('reuses a safe inbound request ID', () => {
    const request = new Request('http://localhost/api/health', {
      headers: { 'X-Request-Id': 'client-request_42' },
    });

    expect(getRequestId(request)).toBe('client-request_42');
  });

  it('replaces unsafe or oversized inbound values with a UUID', () => {
    for (const value of ['contains spaces', 'a'.repeat(65), 'slash/value']) {
      const request = new Request('http://localhost/api/health', {
        headers: { 'X-Request-Id': value },
      });
      const requestId = getRequestId(request);

      expect(requestId).not.toBe(value);
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('creates identifiers accepted by its own validator', () => {
    const requestId = createRequestId();

    expect(isValidRequestId(requestId)).toBe(true);
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
  });

  it('adds the correlation header without replacing existing headers', () => {
    const response = withRequestId(
      new Response(null, { headers: { Location: '/api/generations/gen-1' } }),
      'request-1234',
    );

    expect(response.headers.get('X-Request-Id')).toBe('request-1234');
    expect(response.headers.get('Location')).toBe('/api/generations/gen-1');
  });
});
