export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {}
export class NotFoundError extends AppError {}
export class ConflictError extends AppError {}
export class RateLimitError extends AppError {}
export class AuthenticationError extends AppError {}
export class InitialSessionUnavailableError extends AppError {}
export class ConfigurationUnavailableError extends AppError {}
export class CredentialManagedByEnvironmentError extends ConflictError {}

export class StorageError extends AppError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}
