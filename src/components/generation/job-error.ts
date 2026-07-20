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

const DIAGNOSTIC_CATEGORY_MESSAGE_KEYS = {
  authentication: 'generation.jobError.authentication',
  billing_or_access: 'generation.jobError.billingOrAccess',
  model_or_endpoint: 'generation.jobError.modelOrEndpoint',
  input_invalid: 'generation.jobError.inputInvalid',
  content_policy: 'generation.jobError.contentPolicy',
  remote_asset_unavailable: 'generation.jobError.referenceImage',
  rate_limited: 'generation.jobError.rateLimited',
  provider_unavailable: 'generation.jobError.providerUnavailable',
  request_timeout: 'generation.jobError.timeout',
  no_result: 'generation.jobError.emptyResult',
  upstream_rejected: 'generation.jobError.rejected',
} as const satisfies Partial<Record<
  NonNullable<NonNullable<JobView['error']>['diagnostic']>['category'],
  TranslationKey
>>;

export function getJobErrorMessageKey(
  code: string,
  diagnostic?: NonNullable<JobView['error']>['diagnostic'],
): TranslationKey {
  if (diagnostic && Object.hasOwn(DIAGNOSTIC_CATEGORY_MESSAGE_KEYS, diagnostic.category)) {
    return DIAGNOSTIC_CATEGORY_MESSAGE_KEYS[
      diagnostic.category as keyof typeof DIAGNOSTIC_CATEGORY_MESSAGE_KEYS
    ];
  }
  if (Object.hasOwn(JOB_ERROR_MESSAGE_KEYS, code)) {
    return JOB_ERROR_MESSAGE_KEYS[code as keyof typeof JOB_ERROR_MESSAGE_KEYS];
  }
  return 'generation.jobError.generic';
}

/** A provider request id or recognised provider code is safe to show/copy. */
export function getJobErrorDiagnosticReference(
  error: JobView['error'],
): string | undefined {
  return error?.diagnostic?.providerRequestId ?? error?.diagnostic?.providerCode;
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
