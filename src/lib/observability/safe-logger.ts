import { isValidRequestId } from '../request-id';

export type ApiFailureLog = {
  requestId?: string;
  code: string;
  status: number;
  error?: unknown;
};

const SAFE_ERROR_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'CANCEL_UNSUPPORTED',
  'CONFIGURATION_UNAVAILABLE',
  'CREDENTIAL_MANAGED_BY_ENV',
  'DATABASE_UNAVAILABLE',
  'GENERATION_FINALIZING',
  'IDEMPOTENCY_KEY_REUSED',
  'INTERNAL_ERROR',
  'INVALID_JSON',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'PROVIDER_EMPTY_RESULT',
  'PROVIDER_OUTCOME_UNKNOWN',
  'PROVIDER_PARTIAL_RESULT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_REJECTED',
  'PROVIDER_TIMEOUT',
  'QUEUE_SATURATED',
  'RATE_LIMITED',
  'RETRY_EXHAUSTED',
  'SCHEMA_NOT_READY',
  'STORAGE_RESPONSE_INVALID',
  'VALIDATION_ERROR',
]);

export function logApiFailure(input: ApiFailureLog): void {
  // `error` is accepted so callers do not need a second branch, but raw errors,
  // messages, causes and stacks are intentionally never serialized.
  void input.error;
  const record = {
    level: 'error',
    event: 'api.request_failed',
    requestId: isValidRequestId(input.requestId)
      ? input.requestId
      : 'uncorrelated',
    code: SAFE_ERROR_CODES.has(input.code) ? input.code : 'INTERNAL_ERROR',
    status:
      Number.isInteger(input.status) && input.status >= 400 && input.status <= 599
        ? input.status
        : 500,
  };

  console.error(JSON.stringify(record));
}
