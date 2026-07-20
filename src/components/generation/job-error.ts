import type { TranslationKey } from '@/lib/i18n';
import type { GenerationStatus, JobView } from '@/lib/web-client';

const JOB_ERROR_MESSAGE_KEYS = {
  AUTH_FAILED: 'generation.jobError.authentication',
  QUOTA_EXCEEDED: 'generation.jobError.quota',
  INVALID_REQUEST: 'generation.jobError.rejected',
  RATE_LIMITED: 'generation.jobError.rateLimited',
  PROVIDER_ERROR: 'generation.jobError.provider',
  TIMEOUT: 'generation.jobError.timeout',
  CANCEL_UNSUPPORTED: 'generation.jobError.cancelUnconfirmed',
  CANCEL_UNCONFIRMED: 'generation.jobError.cancelUnconfirmed',
  INTERNAL_ERROR: 'generation.jobError.generic',
  INVALID_HANDLE: 'generation.jobError.generic',
  PROVIDER_NOT_FOUND: 'generation.jobError.provider',
  STORAGE_ERROR: 'generation.jobError.storage',
  PROVIDER_OUTCOME_UNKNOWN: 'generation.jobError.outcomeUnknown',
  PROVIDER_REJECTED: 'generation.jobError.rejected',
  PROVIDER_RATE_LIMITED: 'generation.jobError.rateLimited',
  PROVIDER_TIMEOUT: 'generation.jobError.timeout',
  RETRY_EXHAUSTED: 'generation.jobError.retryExhausted',
  PROVIDER_EMPTY_RESULT: 'generation.jobError.emptyResult',
  PROVIDER_PARTIAL_RESULT: 'generation.jobError.partialResult',
  STORAGE_RESPONSE_INVALID: 'generation.jobError.storage',
  LEGACY_DISPATCH_STATE_UNKNOWN: 'generation.jobError.generic',
} as const satisfies Record<string, TranslationKey>;

export function getJobErrorMessageKey(code: string): TranslationKey {
  if (Object.hasOwn(JOB_ERROR_MESSAGE_KEYS, code)) {
    return JOB_ERROR_MESSAGE_KEYS[code as keyof typeof JOB_ERROR_MESSAGE_KEYS];
  }
  return 'generation.jobError.generic';
}

/**
 * A retryable diagnostic is durable so workers can recover it, but it is not
 * a user-visible failure while the job is still active (or cancelling). A
 * terminal failed job still shows its diagnostic even if a legacy producer
 * marked it retryable.
 */
export function shouldShowJobError(
  status: GenerationStatus,
  error: JobView['error'],
): boolean {
  if (!error) return false;
  return status === 'failed' || error.retryable !== true;
}
