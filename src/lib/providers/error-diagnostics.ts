import type { ProviderId } from './types';

/**
 * A small, stable taxonomy shared by every image provider. Categories are
 * intentionally product-oriented rather than mirroring a provider's message:
 * the latter often contains prompt fragments, URLs, or account information.
 */
export const PROVIDER_DIAGNOSTIC_CATEGORIES = [
  'authentication',
  'billing_or_access',
  'model_or_endpoint',
  'input_invalid',
  'content_policy',
  'remote_asset_unavailable',
  'rate_limited',
  'provider_unavailable',
  'request_timeout',
  'no_result',
  'upstream_rejected',
  'unknown',
] as const;

export type ProviderDiagnosticCategory =
  (typeof PROVIDER_DIAGNOSTIC_CATEGORIES)[number];

/**
 * This is the only provider-owned diagnostic allowed to cross a durability or
 * API boundary. `providerCode` is retained only when it is a code explicitly
 * recognised below; `providerRequestId` is character/length constrained.
 */
export type ProviderDiagnostic = {
  providerId: ProviderId;
  category: ProviderDiagnosticCategory;
  providerCode?: string;
  providerRequestId?: string;
};

type DiagnosticInput = {
  httpStatus?: number;
  providerCode?: unknown;
  providerRequestId?: unknown;
  transportTimeout?: boolean;
  noResult?: boolean;
  upstreamRejected?: boolean;
};

type ClassifiedCode = {
  category: ProviderDiagnosticCategory;
  providerCode?: string;
};

const SAFE_PROVIDER_CODE = /^[A-Za-z0-9._:-]{1,96}$/;
const SAFE_PROVIDER_REQUEST_ID = /^[A-Za-z0-9._:-]{1,160}$/;

function asSafeProviderCode(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_PROVIDER_CODE.test(value)
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : undefined;
}

function asSafeProviderRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_PROVIDER_REQUEST_ID.test(value)
    ? value
    : undefined;
}

function isOneOf(value: string, values: readonly string[]): boolean {
  return values.includes(value);
}

function classified(
  category: ProviderDiagnosticCategory,
  providerCode?: string,
): ClassifiedCode {
  return providerCode === undefined ? { category } : { category, providerCode };
}

function classifyZenmux(code: string): ClassifiedCode | undefined {
  if (code === 'invalid_params') return classified('input_invalid', code);
  if (isOneOf(code, ['insufficient_credit', 'reject_no_credit', 'quote_exceeded'])) {
    return classified('billing_or_access', code);
  }
  if (isOneOf(code, ['model_not_found', 'model_not_exist', 'unsupported_model'])) {
    return classified('model_or_endpoint', code);
  }
  if (code === 'provider_unprocessable_entity_error') {
    return classified('upstream_rejected', code);
  }
  return undefined;
}

function classifyFal(code: string): ClassifiedCode | undefined {
  if (isOneOf(code, ['content_policy_violation', 'nsfw_content_detected'])) {
    return classified('content_policy', code);
  }
  if (isOneOf(code, ['validation_error', 'invalid_request_error', 'invalid_input'])) {
    return classified('input_invalid', code);
  }
  if (code === 'no_media_generated') return classified('no_result', code);
  if (isOneOf(code, ['generation_timeout', 'request_timeout'])) {
    return classified('request_timeout', code);
  }
  if (isOneOf(code, ['rate_limit_exceeded', 'rate_limited'])) {
    return classified('rate_limited', code);
  }
  if (isOneOf(code, ['not_found', 'model_not_found'])) {
    return classified('model_or_endpoint', code);
  }
  return undefined;
}

function classifyQwen(code: string): ClassifiedCode | undefined {
  if (code === 'InvalidApiKey' || code === 'invalid_api_key') {
    return classified('authentication', code);
  }
  if (isOneOf(code, [
    'Arrearage',
    'CommodityNotPurchased',
    'PrepaidBillOverdue',
    'PostpaidBillOverdue',
  ])) {
    return classified('billing_or_access', code);
  }
  if (code === 'NotFound') return classified('model_or_endpoint', code);
  if (code === 'InvalidParameter.DataInspection') {
    return classified('remote_asset_unavailable', code);
  }
  if (code === 'InvalidParameter') return classified('input_invalid', code);
  if (isOneOf(code, ['DataInspectionFailed', 'data_inspection_failed'])) {
    return classified('content_policy', code);
  }
  if (code.startsWith('Throttling')) return classified('rate_limited', code);
  return undefined;
}

function classifyZhipu(code: string): ClassifiedCode | undefined {
  if (isOneOf(code, ['1000', '1001', '1002', '1003', '1004'])) {
    return classified('authentication', code);
  }
  if (code === '1113') return classified('billing_or_access', code);
  if (isOneOf(code, ['1210', '1213', '1214', '1215', '1261'])) {
    return classified('input_invalid', code);
  }
  if (isOneOf(code, ['1211', '1212', '1220', '1221', '1222'])) {
    return classified('model_or_endpoint', code);
  }
  if (code === '1301') return classified('content_policy', code);
  if (isOneOf(code, ['1302', '1303', '1304', '1308'])) {
    return classified('rate_limited', code);
  }
  if (isOneOf(code, ['1305', '1312', '500'])) {
    return classified('provider_unavailable', code);
  }
  return undefined;
}

function classifyDoubao(code: string): ClassifiedCode | undefined {
  if (isOneOf(code, ['MissingParameter', 'InvalidParameter'])) {
    return classified('input_invalid', code);
  }
  if (code === 'InvalidEndpoint.ClosedEndpoint') {
    return classified('provider_unavailable', code);
  }
  if (code.startsWith('InvalidEndpoint.')) {
    return classified('model_or_endpoint', code);
  }
  if (
    code === 'SensitiveContentDetected' ||
    code.includes('SensitiveContentDetected')
  ) {
    return classified('content_policy', code);
  }
  if (isOneOf(code, ['AuthenticationFailed', 'InvalidApiKey'])) {
    return classified('authentication', code);
  }
  if (isOneOf(code, ['Arrearage', 'InsufficientBalance', 'InsufficientQuota'])) {
    return classified('billing_or_access', code);
  }
  if (isOneOf(code, ['RateLimitExceeded', 'TooManyRequests'])) {
    return classified('rate_limited', code);
  }
  return undefined;
}

function classifyKling(code: string): ClassifiedCode | undefined {
  if (isOneOf(code, ['1000', '1001', '1002', '1003', '1004'])) {
    return classified('authentication', code);
  }
  if (isOneOf(code, ['1100', '1101', '1102', '1103', '1304'])) {
    return classified('billing_or_access', code);
  }
  if (isOneOf(code, ['1200', '1201'])) return classified('input_invalid', code);
  if (isOneOf(code, ['1202', '1203'])) {
    return classified('model_or_endpoint', code);
  }
  if (isOneOf(code, ['1300', '1301'])) return classified('content_policy', code);
  if (isOneOf(code, ['1302', '1303'])) return classified('rate_limited', code);
  if (code === '5002') return classified('request_timeout', code);
  if (isOneOf(code, ['5000', '5001'])) {
    return classified('provider_unavailable', code);
  }
  return undefined;
}

function classifyProviderCode(
  providerId: ProviderId,
  providerCode: string,
): ClassifiedCode | undefined {
  switch (providerId) {
    case 'zenmux':
      return classifyZenmux(providerCode);
    case 'fal':
      return classifyFal(providerCode);
    case 'qwen':
      return classifyQwen(providerCode);
    case 'zhipu':
      return classifyZhipu(providerCode);
    case 'doubao':
      return classifyDoubao(providerCode);
    case 'kling':
      return classifyKling(providerCode);
    case 'siliconflow':
      return undefined;
  }
}

function classifyHttpStatus(status: number | undefined): ProviderDiagnosticCategory {
  switch (status) {
    case 401:
      return 'authentication';
    case 402:
    case 403:
      return 'billing_or_access';
    case 404:
      return 'model_or_endpoint';
    case 400:
    case 413:
    case 422:
      return 'input_invalid';
    case 429:
      return 'rate_limited';
    case 503:
    case 504:
      return 'provider_unavailable';
    default:
      return typeof status === 'number' && status >= 500
        ? 'provider_unavailable'
        : 'unknown';
  }
}

/**
 * Converts a provider's raw envelope metadata into a durable/public-safe
 * diagnostic. Unknown provider codes deliberately do not survive this call.
 */
export function classifyProviderDiagnostic(
  providerId: ProviderId,
  input: DiagnosticInput = {},
): ProviderDiagnostic {
  const code = asSafeProviderCode(input.providerCode);
  const classification = code
    ? classifyProviderCode(providerId, code)
    : undefined;
  const category = input.noResult
    ? 'no_result'
    : input.transportTimeout
      ? 'request_timeout'
      : classification?.category ??
        (input.upstreamRejected
          ? 'upstream_rejected'
          : classifyHttpStatus(input.httpStatus));
  const providerRequestId = asSafeProviderRequestId(input.providerRequestId);
  return {
    providerId,
    category,
    ...(classification?.providerCode === undefined
      ? {}
      : { providerCode: classification.providerCode }),
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
  };
}

/** Extracts documented request-id fields without ever scanning error messages. */
export function readProviderRequestId(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  const direct = root.request_id ?? root.requestId;
  if (direct !== undefined) return direct;
  for (const key of ['error', 'output'] as const) {
    const nested = root[key];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const record = nested as Record<string, unknown>;
    const requestId = record.request_id ?? record.requestId;
    if (requestId !== undefined) return requestId;
  }
  return undefined;
}

/**
 * Uses documented structured fields first, then a provider's request-id
 * header. Error text is intentionally never inspected for identifiers.
 */
export function readProviderRequestIdFromResponse(
  payload: unknown,
  headerValues: readonly (string | null | undefined)[] = [],
): unknown {
  const fromPayload = readProviderRequestId(payload);
  if (fromPayload !== undefined) return fromPayload;
  return headerValues.find((value) => value !== null && value !== undefined);
}

/** Returns a public-safe copy, defensively validating a value read from JSON. */
export function toSafeProviderDiagnostic(value: unknown): ProviderDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const providerId = record.providerId;
  const category = record.category;
  if (
    typeof providerId !== 'string' ||
    !isOneOf(providerId, ['fal', 'zenmux', 'siliconflow', 'zhipu', 'doubao', 'qwen', 'kling']) ||
    typeof category !== 'string' ||
    !(PROVIDER_DIAGNOSTIC_CATEGORIES as readonly string[]).includes(category)
  ) {
    return undefined;
  }
  const rawProviderCode = asSafeProviderCode(record.providerCode);
  const verifiedCode = rawProviderCode
    ? classifyProviderCode(providerId as ProviderId, rawProviderCode)
    : undefined;
  const providerCode =
    verifiedCode?.category === category ? verifiedCode.providerCode : undefined;
  const providerRequestId = asSafeProviderRequestId(record.providerRequestId);
  return {
    providerId: providerId as ProviderId,
    category: category as ProviderDiagnosticCategory,
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
  };
}
