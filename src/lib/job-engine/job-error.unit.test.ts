import { describe, expect, it } from 'vitest';

import { toSafeJobError } from './job-error';

describe('public job error DTO', () => {
  it('replaces malformed legacy diagnostics without echoing their contents', () => {
    const canary =
      'private prompt https://signed.example/image.png?token=secret /private/app.db';

    const result = toSafeJobError(canary);

    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The job could not be completed',
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it('maps unknown codes to a safe internal error and discards extra fields', () => {
    const result = toSafeJobError(
      JSON.stringify({
        code: 'UNKNOWN_PRIVATE_PROVIDER_FAILURE',
        message: 'private prompt',
        retryable: true,
        signedUrl: 'https://signed.example/image.png?token=secret',
        storagePath: '/private/app.db',
      }),
    );

    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The job could not be completed',
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private prompt|signed\.example|token=secret|private\/app\.db/,
    );
  });

  it('rejects a malformed diagnostic even when its code is allowlisted', () => {
    expect(
      toSafeJobError(
        JSON.stringify({
          code: 'PROVIDER_ERROR',
          message: { raw: 'private provider payload' },
          retryable: 'yes',
        }),
      ),
    ).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The job could not be completed',
      retryable: false,
    });
  });
});
