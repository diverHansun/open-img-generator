export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {}
export class PayloadTooLargeError extends AppError {}
export class NotFoundError extends AppError {}
export class ConflictError extends AppError {}
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

export class StorageError extends AppError {
  constructor(
    message: string,
    options: {
      cause?: unknown;
      retryable?: boolean;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message);
    this.cause = options.cause;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }

  public readonly cause: unknown;
  /** Only a safe read/download failure may re-enter the storing retry budget. */
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | undefined;
}
