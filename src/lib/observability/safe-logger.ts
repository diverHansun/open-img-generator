import { isValidRequestId } from '../request-id';
import { appendLocalLogLine } from './local-log-sink';

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

type SafeLevel = 'info' | 'warn' | 'error';

export type SafeEventInput =
  | { event: 'storage.ownership_claimed'; ownerHashPrefix: string; adoptedFiles: number }
  | { event: 'storage.ownership_refused'; expectedOwnerHashPrefix: string; actualOwnerHashPrefix: string; reason: 'mismatch' | 'invalid_marker' | 'unsafe_adoption' }
  | { event: 'storage.cleanup_started'; runId: string; referencedFiles: number }
  | { event: 'storage.cleanup_completed'; runId: string; expiredImages: number; deletedFiles: number; deletedOrphans: number; failures: number }
  | { event: 'storage.cleanup_skipped'; runId: string; reason: 'ownership' | 'locked' }
  | { event: 'storage.file_removed'; runId: string; mediaKind: 'image' | 'video' | 'staging' | 'orphan'; entityId: string; reason: 'retention' | 'orphan'; pathHash: string }
  | { event: 'storage.file_remove_failed'; runId: string; entityId: string; code: 'REMOVE_FAILED' }
  | { event: 'storage.missing_detected'; imageId: string; wasFavorite: boolean; requestId?: string }
  | { event: 'storage.recovery_attempted'; entityId: string; provider: string; method: 'provider_poll' | 'metadata_restore' }
  | { event: 'storage.recovery_completed'; entityId: string; provider: string; outcome: 'restored' | 'unavailable' | 'conflict' | 'failed' }
  | { event: 'media.remote_reference_accepted'; imageId: string; provider: string; hostname: string }
  | { event: 'media.remote_redirect_served'; imageId: string; provider: string; hostname: string; route: 'preview' | 'download' }
  | { event: 'worker.tick_failed'; code: string };

const EVENT_LEVELS: Record<SafeEventInput['event'], SafeLevel> = {
  'storage.ownership_claimed': 'info',
  'storage.ownership_refused': 'error',
  'storage.cleanup_started': 'info',
  'storage.cleanup_completed': 'info',
  'storage.cleanup_skipped': 'warn',
  'storage.file_removed': 'info',
  'storage.file_remove_failed': 'error',
  'storage.missing_detected': 'warn',
  'storage.recovery_attempted': 'info',
  'storage.recovery_completed': 'info',
  'media.remote_reference_accepted': 'info',
  'media.remote_redirect_served': 'info',
  'worker.tick_failed': 'error',
};

const SAFE_EVENT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_EVENT_ENUM = new Set([
  'mismatch', 'invalid_marker', 'unsafe_adoption', 'ownership', 'locked',
  'image', 'video', 'staging', 'orphan', 'retention', 'provider_poll',
  'metadata_restore', 'restored', 'unavailable', 'conflict', 'failed',
  'preview', 'download',
]);
const SAFE_PROVIDER = new Set([
  'fal', 'zenmux', 'siliconflow', 'zhipu', 'doubao', 'qwen', 'kling', 'local',
]);

function safeEventString(key: string, value: string): string | undefined {
  if (key.endsWith('HashPrefix') || key === 'pathHash') {
    return /^[a-f0-9]{1,64}$/.test(value) ? value : undefined;
  }
  if (key === 'provider') return SAFE_PROVIDER.has(value) ? value : undefined;
  if (key === 'hostname') {
    return /^(?=.{1,253}$)[A-Za-z0-9.-]+$/.test(value) ? value.toLowerCase() : undefined;
  }
  if (key === 'reason' || key === 'mediaKind' || key === 'method' || key === 'outcome' || key === 'route') {
    return SAFE_EVENT_ENUM.has(value) ? value : undefined;
  }
  if (key === 'code') return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined;
  if (key === 'requestId') return isValidRequestId(value) ? value : 'uncorrelated';
  if (key === 'runId' || key === 'entityId' || key === 'imageId') {
    return SAFE_EVENT_TOKEN.test(value) ? value : 'redacted';
  }
  return undefined;
}

function sanitizeEvent(input: SafeEventInput): Record<string, string | number | boolean> {
  const record: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === 'event') continue;
    if (typeof value === 'string') {
      const safe = safeEventString(key, value);
      if (safe !== undefined) record[key] = safe;
    }
    else if (typeof value === 'number') record[key] = Number.isFinite(value) ? value : 0;
    else if (typeof value === 'boolean') record[key] = value;
  }
  return record;
}

function emitRecord(record: Record<string, unknown>, level: SafeLevel): void {
  let line = JSON.stringify(record);
  if (Buffer.byteLength(line) > 4 * 1024) {
    line = JSON.stringify({
      timestamp: record.timestamp,
      level: 'error',
      event: 'logger.record_rejected',
    });
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
  appendLocalLogLine(line);
}

export function logSafeEvent(input: SafeEventInput): void {
  const level = EVENT_LEVELS[input.event];
  if (!level) return;
  emitRecord(
    {
      timestamp: new Date().toISOString(),
      level,
      event: input.event,
      ...sanitizeEvent(input),
    },
    level,
  );
}

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

  emitRecord({ timestamp: new Date().toISOString(), ...record }, 'error');
}
