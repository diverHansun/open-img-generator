import type { ProviderError, ProviderErrorCode } from './types';

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export function mapHttpStatusToErrorCode(status: number): ProviderErrorCode {
  switch (status) {
    case 401:
      return 'AUTH_FAILED';
    case 403:
      return 'QUOTA_EXCEEDED';
    case 422:
      return 'INVALID_REQUEST';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'PROVIDER_ERROR' : 'UNKNOWN';
  }
}

export function createProviderError(
  status: number,
  message: string,
  retryable = false,
): ProviderError {
  return {
    code: mapHttpStatusToErrorCode(status),
    message,
    retryable,
    httpStatus: status,
  };
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 30_000,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    throw new ProviderHttpError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      responseBody,
    );
  }

  return responseBody;
}

export async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 30_000,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    throw new ProviderHttpError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      responseBody,
    );
  }

  return responseBody;
}

export async function putJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    throw new ProviderHttpError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      responseBody,
    );
  }

  return responseBody;
}
