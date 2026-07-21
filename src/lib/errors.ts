export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {}
export class PayloadTooLargeError extends AppError {}
export class NotFoundError extends AppError {}
export type ImageUnavailableReason =
  | 'retention_expired'
  | 'user_deleted'
  | 'storage_missing';

export class ImageUnavailableError extends AppError {
  constructor(public readonly reason: ImageUnavailableReason) {
    super('Image is no longer available');
  }
}
export class ConflictError extends AppError {}
export class GenerationNotDeletableError extends ConflictError {}
export class OutcomeUnknownDeleteConfirmationRequiredError extends ConflictError {}
/**
 * A client request identity may only describe one canonical generation payload.
 * Keeping this distinct from a generic conflict lets callers preserve the
 * original intent instead of blindly creating (and potentially charging for)
 * a second generation.
 */
export class IdempotencyKeyReusedError extends ConflictError {}
export class RateLimitError extends AppError {}
export class AuthenticationError extends AppError {}
export class InitialSessionUnavailableError extends AppError {}
export class ConfigurationUnavailableError extends AppError {}
export class CredentialManagedByEnvironmentError extends ConflictError {}

export type SchemaCompatibilityDetails = {
  currentVersion: number;
  requiredVersion: number;
  foreignKeysEnabled: boolean;
  missingTables: string[];
  missingColumns: string[];
  missingIndexes: string[];
};

export class SchemaNotReadyError extends AppError {
  constructor(public readonly details: SchemaCompatibilityDetails) {
    super('Database schema is not ready');
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor(public readonly cause?: unknown) {
    super('Database is unavailable');
  }
}

export const STORAGE_DIAGNOSTIC_CATEGORIES = [
  'remote_url_invalid',
  'remote_dns_failed',
  'remote_address_blocked',
  'proxy_mapping_not_trusted',
  'remote_download_timeout',
  'remote_download_failed',
  'remote_http_rejected',
  'remote_content_invalid',
  'local_write_failed',
] as const;

export type StorageDiagnostic = {
  category: (typeof STORAGE_DIAGNOSTIC_CATEGORIES)[number];
  hostname?: string;
};

const SAFE_DIAGNOSTIC_HOSTNAME =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$/;

export function toSafeStorageDiagnostic(
  value: unknown,
): StorageDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const category = Reflect.get(value, 'category');
  if (
    typeof category !== 'string' ||
    !(STORAGE_DIAGNOSTIC_CATEGORIES as readonly string[]).includes(category)
  ) {
    return undefined;
  }
  const hostname = Reflect.get(value, 'hostname');
  return {
    category: category as StorageDiagnostic['category'],
    ...(typeof hostname === 'string' && SAFE_DIAGNOSTIC_HOSTNAME.test(hostname)
      ? { hostname: hostname.toLowerCase() }
      : {}),
  };
}

export class StorageError extends AppError {
  constructor(
    message: string,
    options: {
      cause?: unknown;
      retryable?: boolean;
      retryAfterMs?: number;
      diagnostic?: StorageDiagnostic;
    } = {},
  ) {
    super(message);
    this.cause = options.cause;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.diagnostic = toSafeStorageDiagnostic(options.diagnostic);
  }

  public readonly cause: unknown;
  /** Only a safe read/download failure may re-enter the storing retry budget. */
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | undefined;
  public readonly diagnostic: StorageDiagnostic | undefined;
}
