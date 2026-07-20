import { describe, expect, it, vi } from 'vitest';

import { logApiFailure } from './safe-logger';

describe('safe API logger', () => {
  it('logs only bounded correlation metadata', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'secret-canary prompt https://example.test/image?token=private';

    logApiFailure({
      requestId: 'request-1234',
      code: 'INTERNAL_ERROR',
      status: 500,
      error: new Error(secret),
    });

    expect(errorSpy).toHaveBeenCalledOnce();
    const output = errorSpy.mock.calls.flat().join(' ');
    expect(output).toContain('request-1234');
    expect(output).toContain('INTERNAL_ERROR');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('example.test');
    expect(output).not.toContain('token=private');
    errorSpy.mockRestore();
  });

  it('does not echo an invalid caller-supplied request ID', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logApiFailure({
      requestId: 'unsafe request id with spaces',
      code: 'SECRET_CANARY',
      status: 503,
    });

    const output = errorSpy.mock.calls.flat().join(' ');
    expect(output).not.toContain('unsafe request id with spaces');
    expect(output).not.toContain('SECRET_CANARY');
    expect(output).toContain('uncorrelated');
    expect(output).toContain('INTERNAL_ERROR');
    errorSpy.mockRestore();
  });
});
