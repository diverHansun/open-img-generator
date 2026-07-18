import { NextResponse } from 'next/server';
import {
  ConflictError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  AuthenticationError,
  ConfigurationUnavailableError,
  CredentialManagedByEnvironmentError,
  InitialSessionUnavailableError,
} from '../../lib/errors';

type StructuredApiError = {
  code: string;
  message: string;
  retryable: boolean;
  status: number;
  headers?: HeadersInit;
};

export type ApiErrorOptions = {
  structured?: boolean;
};

function classifyApiError(err: unknown): StructuredApiError {
  if (err instanceof CredentialManagedByEnvironmentError) {
    return {
      code: 'CREDENTIAL_MANAGED_BY_ENV',
      message: err.message,
      retryable: false,
      status: 409,
    };
  }
  if (err instanceof InitialSessionUnavailableError) {
    return {
      code: 'INITIAL_SESSION_UNAVAILABLE',
      message: err.message,
      retryable: true,
      status: 503,
    };
  }
  if (err instanceof ConfigurationUnavailableError) {
    return {
      code: 'CONFIGURATION_UNAVAILABLE',
      message: err.message,
      retryable: false,
      status: 503,
    };
  }
  if (err instanceof ValidationError) {
    return {
      code: 'VALIDATION_ERROR',
      message: err.message,
      retryable: false,
      status: 400,
    };
  }
  if (err instanceof NotFoundError) {
    return {
      code: 'NOT_FOUND',
      message: 'Not found',
      retryable: false,
      status: 404,
    };
  }
  if (err instanceof ConflictError) {
    return {
      code: 'CONFLICT',
      message: err.message,
      retryable: false,
      status: 409,
    };
  }
  if (err instanceof RateLimitError) {
    return {
      code: 'RATE_LIMITED',
      message: err.message,
      retryable: true,
      status: 429,
      headers: { 'Retry-After': '5' },
    };
  }
  if (err instanceof AuthenticationError) {
    return {
      code: 'AUTHENTICATION_REQUIRED',
      message: err.message,
      retryable: false,
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    retryable: true,
    status: 500,
  };
}

export function handleApiError(
  err: unknown,
  options: ApiErrorOptions = {},
): NextResponse {
  const apiError = classifyApiError(err);
  if (options.structured) {
    return NextResponse.json(
      {
        error: {
          code: apiError.code,
          message: apiError.message,
          retryable: apiError.retryable,
        },
      },
      { status: apiError.status, headers: apiError.headers },
    );
  }
  if (apiError.status !== 500) {
    return NextResponse.json(
      { error: apiError.message },
      { status: apiError.status, headers: apiError.headers },
    );
  }
  console.error('API error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
