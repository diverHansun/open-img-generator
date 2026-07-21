import type { NormalizedRequest, ProviderMode } from '../providers';

export const REQUEST_SNAPSHOT_VERSION = 1;
export const MAX_REQUEST_SNAPSHOT_BYTES = 128 * 1_024;

const MAX_SNAPSHOT_DEPTH = 8;
const MAX_SNAPSHOT_KEYS = 256;
const MAX_SNAPSHOT_ARRAY_LENGTH = 64;
const MAX_SNAPSHOT_STRING_LENGTH = 32 * 1_024;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const SNAPSHOT_FIELDS = new Set<keyof NormalizedRequest>([
  'prompt',
  'mode',
  'width',
  'height',
  'aspectRatio',
  'count',
  'negativePrompt',
  'seed',
  'referenceImages',
  'providerOptions',
]);

function snapshotError(): Error {
  // Do not put snapshot content into exception messages: it can contain a
  // reference image URL or prompt and errors may be logged by a caller.
  return new Error('Generation request snapshot is invalid or exceeds its limit');
}

function jsonClone(
  value: unknown,
  state: { depth: number; keys: number; seen: WeakSet<object> },
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > MAX_SNAPSHOT_STRING_LENGTH) {
      throw snapshotError();
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw snapshotError();
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw snapshotError();
  if (state.depth >= MAX_SNAPSHOT_DEPTH || state.seen.has(value)) {
    throw snapshotError();
  }
  state.seen.add(value);
  const priorDepth = state.depth;
  state.depth += 1;
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_SNAPSHOT_ARRAY_LENGTH) throw snapshotError();
      return value.map((item) => jsonClone(item, state));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw snapshotError();
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      state.keys += 1;
      if (state.keys > MAX_SNAPSHOT_KEYS || key.length > 128) throw snapshotError();
      const nested = (value as Record<string, unknown>)[key];
      if (nested !== undefined) {
        result[key] = jsonClone(nested, state);
      }
    }
    return result;
  } finally {
    state.depth = priorDepth;
    state.seen.delete(value);
  }
}

function serializeBounded(value: JsonValue): string {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_SNAPSHOT_BYTES) {
    throw snapshotError();
  }
  return serialized;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > MAX_SNAPSHOT_STRING_LENGTH) {
    throw snapshotError();
  }
  return value;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) throw snapshotError();
  return value as number;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw snapshotError();
  return value as number;
}

function optionalMode(value: unknown): ProviderMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'text-to-image' && value !== 'image-to-image' && value !== 'text-to-video') throw snapshotError();
  return value;
}

function normalizeRequest(value: unknown): NormalizedRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw snapshotError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !SNAPSHOT_FIELDS.has(key as keyof NormalizedRequest))) {
    throw snapshotError();
  }
  if (typeof record.prompt !== 'string' || record.prompt.length === 0) throw snapshotError();
  const request: NormalizedRequest = { prompt: optionalString(record.prompt)! };
  const mode = optionalMode(record.mode);
  if (mode !== undefined) request.mode = mode;
  const width = optionalPositiveInteger(record.width);
  const height = optionalPositiveInteger(record.height);
  if ((width === undefined) !== (height === undefined)) throw snapshotError();
  if (width !== undefined) request.width = width;
  if (height !== undefined) request.height = height;
  const aspectRatio = optionalString(record.aspectRatio);
  if (aspectRatio !== undefined) request.aspectRatio = aspectRatio;
  const count = optionalPositiveInteger(record.count);
  if (count !== undefined) request.count = count;
  const negativePrompt = optionalString(record.negativePrompt);
  if (negativePrompt !== undefined) request.negativePrompt = negativePrompt;
  const seed = optionalInteger(record.seed);
  if (seed !== undefined) request.seed = seed;
  if (record.referenceImages !== undefined) {
    if (
      !Array.isArray(record.referenceImages) ||
      record.referenceImages.length > MAX_SNAPSHOT_ARRAY_LENGTH
    ) {
      throw snapshotError();
    }
    request.referenceImages = record.referenceImages.map((image) => optionalString(image)!);
  }
  if (record.providerOptions !== undefined) {
    const options = jsonClone(record.providerOptions, {
      depth: 0,
      keys: 0,
      seen: new WeakSet(),
    });
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw snapshotError();
    }
    request.providerOptions = options as Record<string, unknown>;
  }
  return request;
}

/** Creates the exact validated input that can later be sent to one provider. */
export function createRequestSnapshot(request: NormalizedRequest): string {
  const normalized = normalizeRequest(request);
  return serializeBounded(
    jsonClone(normalized, { depth: 0, keys: 0, seen: new WeakSet() }),
  );
}

/** Restores only current-format snapshots; unknown versions must never dispatch. */
export function parseRequestSnapshot(
  serialized: string | null,
  version: number | null,
): NormalizedRequest {
  if (version !== REQUEST_SNAPSHOT_VERSION || typeof serialized !== 'string') {
    throw snapshotError();
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_SNAPSHOT_BYTES) {
    throw snapshotError();
  }
  try {
    return normalizeRequest(JSON.parse(serialized));
  } catch {
    throw snapshotError();
  }
}
