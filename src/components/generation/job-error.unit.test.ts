import { describe, expect, it } from 'vitest';

import { getJobErrorMessageKey } from './job-error';

describe('job error presentation', () => {
  it.each([
    ['AUTH_FAILED', 'generation.jobError.authentication'],
    ['QUOTA_EXCEEDED', 'generation.jobError.quota'],
    ['PROVIDER_REJECTED', 'generation.jobError.rejected'],
    ['RATE_LIMITED', 'generation.jobError.rateLimited'],
    ['PROVIDER_TIMEOUT', 'generation.jobError.timeout'],
    ['CANCEL_UNSUPPORTED', 'generation.jobError.cancelUnconfirmed'],
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
});
