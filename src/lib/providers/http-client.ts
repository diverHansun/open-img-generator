import type {
  ProviderError,
  ProviderErrorCode,
  ProviderRequestDisposition,
} from './types';

export const MAX_PROVIDER_RETRY_AFTER_MS = 60_000;
export const DEFAULT_PROVIDER_JSON_RESPONSE_BYTES = 2 * 1_024 * 1_024;
// A 25 MiB binary image expands to about 33.4 MiB in Base64. The current sync
// contract permits one image, so 36 MiB leaves bounded room for JSON metadata.
export const MAX_PROVIDER_INLINE_JSON_RESPONSE_BYTES = 36 * 1_024 * 1_024;

export type ProviderHttpRequestOptions = {
  /** A caller-owned cancellation signal. A signal already aborted before fetch is safe to replay. */
  signal?: AbortSignal;
  /** An absolute wall-clock deadline. The shorter of this and timeoutMs wins. */
  deadlineAt?: number | Date;
  /** Per-operation timeout. Defaults are selected by the HTTP verb helper. */
  timeoutMs?: number;
  /** A bounded JSON envelope size; adapters may lower but never remove it. */
  maxResponseBytes?: number;
};

type ProviderHttpErrorOptions = {
  disposition?: ProviderRequestDisposition;
  retryable?: boolean;
  retryAfterMs?: number;
};

export type ProviderErrorMetadata = Pick<
  ProviderError,
  'disposition' | 'retryAfterMs'
>;

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    options: ProviderHttpErrorOptions = {},
  ) {
    super(message);
    this.name = 'ProviderHttpError';
    this.disposition = options.disposition ?? dispositionForStatus(status);
    this.retryable = options.retryable ?? isRetryableHttpStatus(status);
    this.retryAfterMs = options.retryAfterMs;
  }

  public readonly disposition: ProviderRequestDisposition;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | undefined;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

function dispositionForStatus(status: number): ProviderRequestDisposition {
  // A concrete 4xx response proves the request reached the provider and was
  // rejected. A 5xx response, transport failure, or a response parsing issue
  // cannot prove that the provider did not accept a billable submit.
  return status >= 400 && status < 500 ? 'rejected' : 'unknown';
}

function normalizeRetryAfterMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(MAX_PROVIDER_RETRY_AFTER_MS, Math.ceil(value));
}

/** Parses RFC Retry-After delta-seconds or HTTP-date into a bounded delay. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return normalizeRetryAfterMs(Number(trimmed) * 1_000);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs) || !Number.isFinite(nowMs)) return undefined;
  return normalizeRetryAfterMs(dateMs - nowMs);
}

function normalizeRequestOptions(
  optionsOrTimeout: number | ProviderHttpRequestOptions | undefined,
  defaultTimeoutMs: number,
): ProviderHttpRequestOptions {
  if (typeof optionsOrTimeout === 'number') {
    return { timeoutMs: optionsOrTimeout };
  }
  return optionsOrTimeout ?? {};
}

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

function normalizeResponseLimitBytes(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return DEFAULT_PROVIDER_JSON_RESPONSE_BYTES;
  }
  // The generic JSON envelope is never a Base64 transport. Endpoints which
  // legitimately carry inline images must use E3's dedicated staged parser,
  // rather than opting out of this common bound.
  return Math.min(DEFAULT_PROVIDER_JSON_RESPONSE_BYTES, Math.floor(value));
}

function deadlineMs(value: number | Date | undefined): number | undefined {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

type ComposedRequestSignal = {
  signal: AbortSignal;
  cleanup: () => void;
};

function signalForRequest(
  options: ProviderHttpRequestOptions,
  defaultTimeoutMs: number,
): ComposedRequestSignal {
  if (options.signal?.aborted) {
    throw new ProviderHttpError(
      'Provider request was cancelled before it started',
      0,
      null,
      { disposition: 'not_started', retryable: true },
    );
  }

  const now = Date.now();
  const configuredTimeoutMs = normalizeTimeoutMs(options.timeoutMs, defaultTimeoutMs);
  const remainingDeadlineMs = deadlineMs(options.deadlineAt);
  const timeoutMs = remainingDeadlineMs === undefined
    ? configuredTimeoutMs
    : Math.min(configuredTimeoutMs, remainingDeadlineMs - now);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ProviderHttpError(
      'Provider request deadline elapsed before it started',
      0,
      null,
      { disposition: 'not_started', retryable: true },
    );
  }

  const timeoutSignal = AbortSignal.timeout(Math.floor(timeoutMs));
  if (!options.signal) {
    return { signal: timeoutSignal, cleanup: () => {} };
  }

  // Node 20.0–20.2 does not yet provide AbortSignal.any(), while the package
  // still supports that range. Keep cancellation active through response-body
  // consumption and remove fallback listeners after the request settles.
  if (typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any([options.signal, timeoutSignal]),
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted || timeoutSignal.aborted) abort();
  return {
    signal: controller.signal,
    cleanup: () => {
      options.signal?.removeEventListener('abort', abort);
      timeoutSignal.removeEventListener('abort', abort);
    },
  };
}

export function mapHttpStatusToErrorCode(status: number): ProviderErrorCode {
  switch (status) {
    case 0:
      return 'UNKNOWN';
    case 400:
      return 'INVALID_REQUEST';
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
  metadata: ProviderErrorMetadata = {},
): ProviderError {
  return {
    // Adapters pass status=0 for both transport failures and AbortSignal
    // timeouts. The retryable bit distinguishes the latter without adding a
    // provider-specific error type to this shared HTTP helper.
    code: status === 0 && retryable ? 'TIMEOUT' : mapHttpStatusToErrorCode(status),
    message,
    retryable,
    httpStatus: status,
    ...metadata,
  };
}

/**
 * Retains only structured HTTP metadata for adapters. Callers may choose a
 * provider-specific human diagnostic, but the lifecycle will never persist it.
 */
export function createProviderErrorFromHttpError(
  error: ProviderHttpError,
  message = error.message,
): ProviderError {
  return createProviderError(error.status, message, error.retryable, {
    disposition: error.disposition,
    ...(error.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: error.retryAfterMs }),
  });
}

function responseRetryAfter(response: Response): number | undefined {
  try {
    return parseRetryAfter(response.headers?.get('retry-after'));
  } catch {
    return undefined;
  }
}

function hasExplicitlyEmptyBody(response: Response): boolean {
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return true;
  }
  try {
    return response.headers?.get('content-length') === '0';
  } catch {
    return false;
  }
}

function declaredBodyExceedsLimit(response: Response, limitBytes: number): boolean {
  try {
    const value = response.headers?.get('content-length');
    if (!value || !/^\d+$/.test(value.trim())) return false;
    return Number(value) > limitBytes;
  } catch {
    return false;
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response body is disposable after a bounded read refusal.
  }
}

async function readBoundedResponseJson(
  response: Response,
  limitBytes: number,
): Promise<unknown> {
  if (declaredBodyExceedsLimit(response, limitBytes)) {
    await cancelResponseBody(response);
    throw new Error('response_limit_exceeded');
  }
  // Existing unit fixtures use Response-shaped objects without a stream. Native
  // fetch responses always expose a stream for non-empty bodies; production
  // reads therefore take the bounded path below.
  if (!response.body) return response.json();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limitBytes) {
        await reader.cancel();
        throw new Error('response_limit_exceeded');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buffer));
}

async function readErrorJsonOrNull(
  response: Response,
  limitBytes: number,
): Promise<unknown> {
  try {
    return await readBoundedResponseJson(response, limitBytes);
  } catch {
    return null;
  }
}

async function readSuccessJson(
  response: Response,
  allowEmptySuccessBody: boolean,
  limitBytes: number,
): Promise<unknown> {
  if (allowEmptySuccessBody && hasExplicitlyEmptyBody(response)) return null;
  try {
    return await readBoundedResponseJson(response, limitBytes);
  } catch {
    // The remote endpoint responded, but a truncated/aborted/malformed 2xx
    // body cannot prove the submit result. Read-only poll/cancel callers keep
    // their own retry budget via the retryable metadata below.
    throw new ProviderHttpError(
      'Provider response could not be read',
      response.status,
      null,
      { disposition: 'unknown', retryable: true },
    );
  }
}

type JsonRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  options: ProviderHttpRequestOptions;
  defaultTimeoutMs: number;
  allowEmptySuccessBody?: boolean;
  inlineImageResponse?: boolean;
};

async function requestJson(request: JsonRequest): Promise<unknown> {
  const requestSignal = signalForRequest(
    request.options,
    request.defaultTimeoutMs,
  );
  try {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: requestSignal.signal,
        redirect: 'manual',
      });
    } catch {
      // Once fetch has been entered, native fetch cannot prove that no request
      // bytes reached the provider. Keep submit conservative and let poll/cancel
      // use their independent retry budgets.
      throw new ProviderHttpError(
        'Provider request did not complete',
        0,
        null,
        { disposition: 'unknown', retryable: true },
      );
    }

    if (!response.ok) {
      const responseBody = await readErrorJsonOrNull(
        response,
        normalizeResponseLimitBytes(request.options.maxResponseBytes),
      );
      throw new ProviderHttpError(
        'Provider request was rejected',
        response.status,
        responseBody,
        { retryAfterMs: responseRetryAfter(response) },
      );
    }
    return readSuccessJson(
      response,
      request.allowEmptySuccessBody ?? false,
      request.inlineImageResponse
        ? MAX_PROVIDER_INLINE_JSON_RESPONSE_BYTES
        : normalizeResponseLimitBytes(request.options.maxResponseBytes),
    );
  } finally {
    requestSignal.cleanup();
  }
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  optionsOrTimeout?: number | ProviderHttpRequestOptions,
): Promise<unknown> {
  return requestJson({
    method: 'POST',
    url,
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
    options: normalizeRequestOptions(optionsOrTimeout, 30_000),
    defaultTimeoutMs: 30_000,
  });
}

/**
 * A narrowly scoped POST helper for the current one-image sync adapters whose
 * success payload may contain `b64_json`. It uses a fixed 36 MiB ceiling; the
 * lifecycle immediately stages and validates the decoded image before any
 * durable snapshot is written.
 */
export async function postJsonWithInlineImageResponse(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  optionsOrTimeout?: number | ProviderHttpRequestOptions,
): Promise<unknown> {
  return requestJson({
    method: 'POST',
    url,
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
    options: normalizeRequestOptions(optionsOrTimeout, 30_000),
    defaultTimeoutMs: 30_000,
    inlineImageResponse: true,
  });
}

export async function getJson(
  url: string,
  headers: Record<string, string>,
  optionsOrTimeout?: number | ProviderHttpRequestOptions,
): Promise<unknown> {
  return requestJson({
    method: 'GET',
    url,
    headers,
    options: normalizeRequestOptions(optionsOrTimeout, 15_000),
    defaultTimeoutMs: 15_000,
  });
}

export async function putJson(
  url: string,
  headers: Record<string, string>,
  optionsOrTimeout?: number | ProviderHttpRequestOptions,
): Promise<unknown> {
  return requestJson({
    method: 'PUT',
    url,
    headers,
    options: normalizeRequestOptions(optionsOrTimeout, 10_000),
    defaultTimeoutMs: 10_000,
    allowEmptySuccessBody: true,
  });
}

export async function deleteJson(
  url: string,
  headers: Record<string, string>,
  optionsOrTimeout?: number | ProviderHttpRequestOptions,
): Promise<unknown> {
  return requestJson({
    method: 'DELETE',
    url,
    headers,
    options: normalizeRequestOptions(optionsOrTimeout, 10_000),
    defaultTimeoutMs: 10_000,
    allowEmptySuccessBody: true,
  });
}
