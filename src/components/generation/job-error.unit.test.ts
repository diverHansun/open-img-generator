import { describe, expect, it } from 'vitest';

import {
  getJobErrorDiagnosticReference,
  getJobErrorMessageKey,
  shouldShowJobError,
} from './job-error';

describe('job error presentation', () => {
  it.each([
    ['AUTH_FAILED', 'generation.jobError.authentication'],
    ['QUOTA_EXCEEDED', 'generation.jobError.quota'],
    ['PROVIDER_REJECTED', 'generation.jobError.rejected'],
    ['RATE_LIMITED', 'generation.jobError.rateLimited'],
    ['PROVIDER_TIMEOUT', 'generation.jobError.timeout'],
    ['CANCEL_UNSUPPORTED', 'generation.jobError.cancelUnconfirmed'],
    ['CANCEL_UNCONFIRMED', 'generation.jobError.cancelUnconfirmed'],
    ['STORAGE_RESPONSE_INVALID', 'generation.jobError.storage'],
    ['PROVIDER_OUTCOME_UNKNOWN', 'generation.jobError.outcomeUnknown'],
    ['RETRY_EXHAUSTED', 'generation.jobError.retryExhausted'],
    ['PROVIDER_EMPTY_RESULT', 'generation.jobError.emptyResult'],
    ['PROVIDER_PARTIAL_RESULT', 'generation.jobError.partialResult'],
  ] as const)('maps %s to a translated safe message', (code, messageKey) => {
    expect(getJobErrorMessageKey(code)).toBe(messageKey);
  });

  it('falls back to a generic translation for legacy or untrusted codes', () => {
    const canary = 'SIGNED_URL=https://secret.example/image?token=canary';

    const messageKey = getJobErrorMessageKey(canary);

    expect(messageKey).toBe('generation.jobError.generic');
    expect(messageKey).not.toContain(canary);
  });

  it('uses the provider diagnostic category and only exposes safe references', () => {
    expect(
      getJobErrorMessageKey('INVALID_REQUEST', {
        providerId: 'kling',
        category: 'content_policy',
        providerCode: '1301',
      }),
    ).toBe('generation.jobError.contentPolicy');
    expect(
      getJobErrorDiagnosticReference({
        code: 'INVALID_REQUEST',
        message: 'internal',
        retryable: false,
        diagnostic: {
          providerId: 'kling',
          category: 'content_policy',
          providerCode: '1301',
          providerRequestId: 'req-123',
        },
      }),
    ).toBe('req-123');
  });

  it('uses safe storage diagnostics and exposes only their hostname', () => {
    const storageDiagnostic = {
      category: 'proxy_mapping_not_trusted' as const,
      hostname: 'img.example.com',
    };
    expect(
      getJobErrorMessageKey('STORAGE_ERROR', undefined, storageDiagnostic),
    ).toBe('generation.jobError.storageProxyMapping');
    expect(
      getJobErrorDiagnosticReference({
        code: 'STORAGE_ERROR',
        message: 'internal',
        retryable: false,
        storageDiagnostic,
      }),
    ).toBe('img.example.com');
  });

  it('does not present transient retry diagnostics as a failed active job', () => {
    const transient = { code: 'TIMEOUT', message: 'internal', retryable: true };

    expect(shouldShowJobError('pending', transient)).toBe(false);
    expect(shouldShowJobError('running', transient)).toBe(false);
    expect(shouldShowJobError('cancelled', transient)).toBe(false);
    expect(shouldShowJobError('failed', transient)).toBe(true);
    expect(
      shouldShowJobError('cancelled', {
        code: 'CANCEL_UNSUPPORTED',
        message: 'internal',
        retryable: false,
      }),
    ).toBe(true);
    expect(
      shouldShowJobError('cancelled', {
        code: 'TIMEOUT',
        message: 'internal',
        retryable: false,
      }),
    ).toBe(true);
  });
});
