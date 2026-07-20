import { NextResponse } from 'next/server';
import {
  ConflictError,
  IdempotencyKeyReusedError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  AuthenticationError,
  ConfigurationUnavailableError,
  CredentialManagedByEnvironmentError,
  InitialSessionUnavailableError,
  SchemaNotReadyError,
  DatabaseUnavailableError,
} from '../../lib/errors';
import { logApiFailure } from '../../lib/observability/safe-logger';
import {
  createRequestId,
  isValidRequestId,
  withRequestId,
} from '../../lib/request-id';

type SafeErrorDetails = Record<
  string,
  string | number | boolean | string[]
>;

type StructuredApiError = {
  code: string;
  message: string;
  safeMessage: string;
  retryable: boolean;
  status: number;
  headers?: HeadersInit;
  details?: SafeErrorDetails;
};

export type ApiErrorOptions = {
  structured?: boolean;
  requestId?: string;
  unexpectedRetryable?: boolean;
};

const SCHEMA_IDENTIFIER =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function safeSchemaIdentifiers(values: unknown): string[] {
  return (Array.isArray(values) ? values : [])
    .filter(
      (value): value is string =>
        typeof value === 'string' &&
        value.length <= 128 &&
        SCHEMA_IDENTIFIER.test(value),
    )
    .slice(0, 100);
}

function safeSchemaDetails(error: SchemaNotReadyError): SafeErrorDetails {
  const details = error.details;
  return {
    currentVersion:
      Number.isSafeInteger(details.currentVersion) && details.currentVersion >= 0
        ? details.currentVersion
        : 0,
    requiredVersion:
      Number.isSafeInteger(details.requiredVersion) && details.requiredVersion >= 0
        ? details.requiredVersion
        : 0,
    foreignKeysEnabled: details.foreignKeysEnabled === true,
    missingTables: safeSchemaIdentifiers(details.missingTables),
    missingColumns: safeSchemaIdentifiers(details.missingColumns),
    missingIndexes: safeSchemaIdentifiers(details.missingIndexes),
  };
}

function classifyApiError(err: unknown): StructuredApiError {
  if (err instanceof SchemaNotReadyError) {
    return {
      code: 'SCHEMA_NOT_READY',
      message: err.message,
      safeMessage: 'Database schema is not ready',
      retryable: false,
      status: 503,
      details: safeSchemaDetails(err),
    };
  }
  if (err instanceof DatabaseUnavailableError) {
    return {
      code: 'DATABASE_UNAVAILABLE',
      message: err.message,
      safeMessage: 'Database is unavailable',
      retryable: true,
      status: 503,
    };
  }
  if (err instanceof CredentialManagedByEnvironmentError) {
    return {
      code: 'CREDENTIAL_MANAGED_BY_ENV',
      message: err.message,
      safeMessage: 'Credential is managed by the environment',
      retryable: false,
      status: 409,
    };
  }
  if (err instanceof InitialSessionUnavailableError) {
    return {
      code: 'INITIAL_SESSION_UNAVAILABLE',
      message: err.message,
      safeMessage: 'Initial session is unavailable',
      retryable: true,
      status: 503,
    };
  }
  if (err instanceof ConfigurationUnavailableError) {
    return {
      code: 'CONFIGURATION_UNAVAILABLE',
      message: err.message,
      safeMessage: 'Provider configuration is unavailable',
      retryable: false,
      status: 503,
    };
  }
  if (err instanceof ValidationError) {
    return {
      code: 'VALIDATION_ERROR',
      message: err.message,
      safeMessage: 'Request validation failed',
      retryable: false,
      status: 400,
    };
  }
  if (err instanceof NotFoundError) {
    return {
      code: 'NOT_FOUND',
      message: 'Not found',
      safeMessage: 'Not found',
      retryable: false,
      status: 404,
    };
  }
  if (err instanceof ConflictError) {
    if (err instanceof IdempotencyKeyReusedError) {
      return {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: err.message,
        safeMessage: 'Idempotency key was already used for a different request',
        retryable: false,
        status: 409,
      };
    }
    return {
      code: 'CONFLICT',
      message: err.message,
      safeMessage: 'Request conflicts with existing state',
      retryable: false,
      status: 409,
    };
  }
  if (err instanceof RateLimitError) {
    return {
      code: 'RATE_LIMITED',
      message: err.message,
      safeMessage: 'Too many requests; retry later',
      retryable: true,
      status: 429,
      headers: { 'Retry-After': '5' },
    };
  }
  if (err instanceof AuthenticationError) {
    return {
      code: 'AUTHENTICATION_REQUIRED',
      message: err.message,
      safeMessage: 'Authentication required',
      retryable: false,
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    safeMessage: 'Internal server error',
    retryable: true,
    status: 500,
  };
}

export function handleApiError(
  err: unknown,
  options: ApiErrorOptions = {},
): NextResponse {
  const apiError = classifyApiError(err);
  const requestId =
    options.requestId === undefined
      ? undefined
      : isValidRequestId(options.requestId)
        ? options.requestId
        : createRequestId();

  if (apiError.status >= 500) {
    logApiFailure({
      requestId,
      code: apiError.code,
      status: apiError.status,
      error: err,
    });
  }

  if (options.structured) {
    const retryable =
      apiError.code === 'INTERNAL_ERROR' &&
      options.unexpectedRetryable !== undefined
        ? options.unexpectedRetryable
        : apiError.retryable;
    const response = NextResponse.json(
      {
        error: {
          code: apiError.code,
          message: requestId ? apiError.safeMessage : apiError.message,
          retryable,
          ...(requestId ? { requestId } : {}),
          ...(apiError.details ? { details: apiError.details } : {}),
        },
      },
      { status: apiError.status, headers: apiError.headers },
    );
    return requestId ? withRequestId(response, requestId) : response;
  }
  if (apiError.status !== 500) {
    const response = NextResponse.json(
      { error: apiError.message },
      { status: apiError.status, headers: apiError.headers },
    );
    return requestId ? withRequestId(response, requestId) : response;
  }
  const response = NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 },
  );
  return requestId ? withRequestId(response, requestId) : response;
}
