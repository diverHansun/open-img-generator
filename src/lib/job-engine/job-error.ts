import type { JobView } from './types';
import { toSafeProviderDiagnostic } from '../providers/error-diagnostics';

type SafeJobError = NonNullable<JobView['error']>;

const SAFE_JOB_ERRORS = {
  AUTH_FAILED: {
    message: 'Provider authentication failed',
    retryable: false,
  },
  QUOTA_EXCEEDED: {
    message: 'Provider quota was exceeded',
    retryable: false,
  },
  INVALID_REQUEST: {
    message: 'Provider rejected the request',
    retryable: false,
  },
  RATE_LIMITED: {
    message: 'Provider rate limit was reached',
    retryable: true,
  },
  QUEUE_SATURATED: {
    message: 'Provider queue is busy; the job will be retried',
    retryable: true,
  },
  PROVIDER_ERROR: {
    message: 'Provider could not complete the job',
    retryable: true,
  },
  TIMEOUT: {
    message: 'Provider request timed out',
    retryable: true,
  },
  CANCEL_UNSUPPORTED: {
    message: 'Remote cancellation could not be confirmed',
    retryable: false,
  },
  CANCEL_UNCONFIRMED: {
    message: 'Remote cancellation could not be confirmed',
    retryable: false,
  },
  INTERNAL_ERROR: {
    message: 'The job could not be completed',
    retryable: false,
  },
  INVALID_HANDLE: {
    message: 'The provider job reference is invalid',
    retryable: false,
  },
  PROVIDER_NOT_FOUND: {
    message: 'The configured provider is unavailable',
    retryable: false,
  },
  STORAGE_ERROR: {
    message: 'The generated image could not be stored',
    retryable: true,
  },
  PROVIDER_OUTCOME_UNKNOWN: {
    message:
      'The provider may have accepted the job; check its status before retrying',
    retryable: false,
  },
  PROVIDER_REJECTED: {
    message: 'The provider rejected the job',
    retryable: false,
  },
  PROVIDER_RATE_LIMITED: {
    message: 'Provider rate limit was reached',
    retryable: true,
  },
  PROVIDER_TIMEOUT: {
    message: 'Provider request timed out',
    retryable: true,
  },
  RETRY_EXHAUSTED: {
    message: 'The job retry budget was exhausted',
    retryable: false,
  },
  PROVIDER_EMPTY_RESULT: {
    message: 'The provider returned no images',
    retryable: false,
  },
  PROVIDER_PARTIAL_RESULT: {
    message: 'The provider returned only part of the requested result',
    retryable: false,
  },
  STORAGE_RESPONSE_INVALID: {
    message: 'The returned image could not be stored',
    retryable: false,
  },
  LEGACY_DISPATCH_STATE_UNKNOWN: {
    message: 'The legacy job state could not be recovered',
    retryable: false,
  },
} as const satisfies Record<string, { message: string; retryable: boolean }>;

export type SafeJobErrorCode = keyof typeof SAFE_JOB_ERRORS;

const SAFE_INTERNAL_ERROR: SafeJobError = {
  code: 'INTERNAL_ERROR',
  message: SAFE_JOB_ERRORS.INTERNAL_ERROR.message,
  retryable: SAFE_JOB_ERRORS.INTERNAL_ERROR.retryable,
};

export function isSafeJobErrorCode(code: unknown): code is SafeJobErrorCode {
  return typeof code === 'string' && Object.hasOwn(SAFE_JOB_ERRORS, code);
}

/**
 * Persists an allowlisted diagnostic only. Provider-originated messages must
 * never enter the durable job row because they can contain prompts, signed
 * URLs, or provider payloads.
 */
export function serializeSafeJobError(
  code: unknown,
  retryable: boolean,
  fallbackCode: SafeJobErrorCode = 'INTERNAL_ERROR',
  diagnostic?: unknown,
): string {
  const safeCode = isSafeJobErrorCode(code) ? code : fallbackCode;
  const safeDiagnostic = toSafeProviderDiagnostic(diagnostic);
  return JSON.stringify({
    code: safeCode,
    message: SAFE_JOB_ERRORS[safeCode].message,
    retryable,
    ...(safeDiagnostic === undefined ? {} : { diagnostic: safeDiagnostic }),
  });
}

/**
 * Turns the diagnostic persisted by the worker into the small public DTO exposed
 * by generation detail/cancel endpoints. Stored messages and extra fields may
 * contain provider payloads, prompts, paths or signed URLs and are never copied.
 */
export function toSafeJobError(serialized: string | null): JobView['error'] {
  if (!serialized) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ...SAFE_INTERNAL_ERROR };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof Reflect.get(parsed, 'message') !== 'string' ||
    typeof Reflect.get(parsed, 'retryable') !== 'boolean' ||
    !isSafeJobErrorCode(Reflect.get(parsed, 'code'))
  ) {
    return { ...SAFE_INTERNAL_ERROR };
  }

  const code = Reflect.get(parsed, 'code') as keyof typeof SAFE_JOB_ERRORS;
  const policy = SAFE_JOB_ERRORS[code];
  const diagnostic = toSafeProviderDiagnostic(Reflect.get(parsed, 'diagnostic'));
  return {
    code,
    message: policy.message,
    // The code controls the public message, while the persisted boolean is
    // deliberately retained: a provider can make an otherwise retryable code
    // terminal for this specific job (for example a non-retryable timeout).
    retryable: Reflect.get(parsed, 'retryable') as boolean,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  };
}
