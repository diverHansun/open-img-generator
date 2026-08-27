import { createHash } from 'node:crypto';

import { ValidationError } from '../errors';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type GenerationIdempotencyInput = {
  clientRequestId?: unknown;
};

export type GenerationIdempotency = {
  clientRequestId: string;
  requestHash: string;
};

const RFC_4122_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalizeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  location: 'object-property' | 'array-item' | 'root',
): JsonValue | undefined {
  if (value === undefined) {
    return location === 'object-property' ? undefined : null;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Generation payload must contain finite numbers');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new ValidationError('Generation payload must be JSON-serializable');
  }
  if (ancestors.has(value)) {
    throw new ValidationError('Generation payload must not contain circular references');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(
        (item) => canonicalizeJsonValue(item, ancestors, 'array-item') ?? null,
      );
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValidationError('Generation payload must contain plain objects');
    }

    const canonicalObject: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    for (const key of Object.keys(value).sort()) {
      const canonicalValue = canonicalizeJsonValue(
        (value as Record<string, unknown>)[key],
        ancestors,
        'object-property',
      );
      if (canonicalValue !== undefined) {
        canonicalObject[key] = canonicalValue;
      }
    }
    return canonicalObject;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Validates a canonical RFC 4122 UUID and normalizes its hexadecimal digits.
 * Normalization keeps SQLite's case-sensitive unique key aligned with UUID identity.
 */
export function normalizeClientRequestId(value: unknown): string {
  if (typeof value !== 'string' || !RFC_4122_UUID_PATTERN.test(value)) {
    throw new ValidationError('clientRequestId must be a valid RFC 4122 UUID');
  }
  return value.toLowerCase();
}

/**
 * Produces deterministic JSON for the admitted request payload.
 * clientRequestId identifies the intent and is deliberately not part of its content hash.
 */
export function canonicalizeGenerationPayload(
  input: GenerationIdempotencyInput,
): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Generation payload must be an object');
  }

  const payload = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== 'clientRequestId') {
      payload[key] = (input as Record<string, unknown>)[key];
    }
  }

  const canonical = canonicalizeJsonValue(payload, new Set(), 'root');
  return JSON.stringify(canonical);
}

export function hashGenerationPayload(
  input: GenerationIdempotencyInput,
): string {
  return createHash('sha256')
    .update(canonicalizeGenerationPayload(input), 'utf8')
    .digest('hex');
}

/** Server-side entry point used by admission before create-or-replay. */
export function prepareGenerationIdempotency(
  input: GenerationIdempotencyInput,
): GenerationIdempotency {
  return {
    clientRequestId: normalizeClientRequestId(input.clientRequestId),
    requestHash: hashGenerationPayload(input),
  };
}
