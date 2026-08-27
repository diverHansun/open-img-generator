import { describe, expect, it } from 'vitest';

import { serializeSafeJobError, toSafeJobError } from './job-error';

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

  it('keeps a verified terminal retryability decision while redacting the message', () => {
    const result = toSafeJobError(
      JSON.stringify({
        code: 'TIMEOUT',
        message:
          'private provider payload https://signed.example/image?token=secret',
        retryable: false,
      }),
    );

    expect(result).toEqual({
      code: 'TIMEOUT',
      message: 'Provider request timed out',
      retryable: false,
    });
  });

  it('keeps only allowlisted provider diagnostics', () => {
    const serialized = serializeSafeJobError(
      'INVALID_REQUEST',
      false,
      'PROVIDER_ERROR',
      {
        providerId: 'doubao',
        category: 'content_policy',
        providerCode: 'SensitiveContentDetected',
        providerRequestId: 'req-123',
        rawMessage: 'prompt https://signed.example/image?token=secret',
      },
    );

    expect(serialized).not.toContain('signed.example');
    expect(toSafeJobError(serialized)).toEqual({
      code: 'INVALID_REQUEST',
      message: 'Provider rejected the request',
      retryable: false,
      diagnostic: {
        providerId: 'doubao',
        category: 'content_policy',
        providerCode: 'SensitiveContentDetected',
        providerRequestId: 'req-123',
      },
    });
  });

  it('keeps only a safe storage category and hostname', () => {
    const serialized = serializeSafeJobError(
      'STORAGE_ERROR',
      false,
      'INTERNAL_ERROR',
      undefined,
      {
        category: 'proxy_mapping_not_trusted',
        hostname: 'IMG.Example.COM',
        signedUrl: 'https://img.example.com/file?token=secret',
      },
    );
    expect(serialized).not.toContain('token=secret');
    expect(toSafeJobError(serialized)).toMatchObject({
      storageDiagnostic: {
        category: 'proxy_mapping_not_trusted',
        hostname: 'img.example.com',
      },
    });
  });
});
