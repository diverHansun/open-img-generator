import type { SubmitGenerationPayload } from './types';

const INTENT_STORAGE_KEY = 'open-img.pending-generation-intent.v1';
const INTENT_TTL_MS = 24 * 60 * 60 * 1_000;

type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type SubmissionIntent = {
  clientRequestId: string;
  payloadHash: string;
  projectId: string;
  sessionId: string;
  createdAt: number;
};

export type ResolveSubmissionIntentInput = {
  projectId: string;
  sessionId: string;
  payload: SubmitGenerationPayload;
};

export type SubmissionIntentOptions = {
  storage?: IntentStorage | null;
  now?: () => number;
  createId?: () => string;
  hashPayload?: (payload: SubmitGenerationPayload) => Promise<string>;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The live browser runtime is the source of truth for a pending submission.
 * sessionStorage is only its reload-survival mirror: it can be unavailable in
 * privacy modes or reject writes when quota is exhausted. Keeping the opaque
 * intent in memory means a retry in the same page never silently gets a new
 * idempotency key after the server may already have accepted the first request.
 */
let runtimeIntent: SubmissionIntent | null = null;

function canonicalize(value: unknown, inArray = false): JsonValue | undefined {
  if (value === undefined) return inArray ? null : undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Generation intent contains an invalid number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new Error('Generation intent must be JSON-serializable');
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, true) ?? null);
  }
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = canonicalize(
      (value as Record<string, unknown>)[key],
    );
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

/** Browser-safe deterministic identity; it never stores the raw payload. */
export function canonicalizeSubmissionPayload(
  payload: SubmitGenerationPayload,
): string {
  return JSON.stringify(canonicalize(payload));
}

export async function hashSubmissionPayload(
  payload: SubmitGenerationPayload,
): Promise<string> {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle) {
    throw new Error('Web Crypto is required to preserve a generation intent');
  }
  const bytes = new TextEncoder().encode(canonicalizeSubmissionPayload(payload));
  const digest = await webCrypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function createClientRequestId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID().toLowerCase();
  }
  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }
  throw new Error('Secure browser randomness is required to create a generation intent');
}

function defaultStorage(): IntentStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readIntent(storage: IntentStorage | null): SubmissionIntent | null {
  if (runtimeIntent) return runtimeIntent;
  if (!storage) return null;
  try {
    const raw = storage.getItem(INTENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SubmissionIntent>;
    if (
      typeof parsed.clientRequestId !== 'string' ||
      typeof parsed.payloadHash !== 'string' ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      !Number.isFinite(parsed.createdAt)
    ) {
      storage.removeItem(INTENT_STORAGE_KEY);
      return null;
    }
    runtimeIntent = parsed as SubmissionIntent;
    return runtimeIntent;
  } catch {
    // A previously created runtime intent is still safe to replay when storage
    // becomes unreadable. There is no raw prompt in this record.
    return runtimeIntent;
  }
}

function persistIntent(storage: IntentStorage | null, intent: SubmissionIntent): void {
  runtimeIntent = intent;
  if (!storage) return;
  try {
    storage.setItem(INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Runtime memory remains available for safe retries in this page lifecycle.
  }
}

function removeIntent(storage: IntentStorage | null): void {
  runtimeIntent = null;
  if (!storage) return;
  try {
    storage.removeItem(INTENT_STORAGE_KEY);
  } catch {
    // Storage may be blocked; there is no durable item to clean up.
  }
}

export async function resolveSubmissionIntent(
  input: ResolveSubmissionIntentInput,
  options: SubmissionIntentOptions = {},
): Promise<{ intent: SubmissionIntent; reused: boolean }> {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now?.() ?? Date.now();
  const payloadHash = await (options.hashPayload ?? hashSubmissionPayload)(
    input.payload,
  );
  const existing = readIntent(storage);
  if (
    existing &&
    now - existing.createdAt >= 0 &&
    now - existing.createdAt < INTENT_TTL_MS &&
    existing.projectId === input.projectId &&
    existing.sessionId === input.sessionId &&
    existing.payloadHash === payloadHash
  ) {
    return { intent: existing, reused: true };
  }
  if (existing) removeIntent(storage);

  const intent: SubmissionIntent = {
    clientRequestId: (options.createId ?? createClientRequestId)(),
    payloadHash,
    projectId: input.projectId,
    sessionId: input.sessionId,
    createdAt: now,
  };
  persistIntent(storage, intent);
  return { intent, reused: false };
}

/** Clears only the intent that received a definitive response. */
export function clearSubmissionIntent(
  clientRequestId: string,
  options: Pick<SubmissionIntentOptions, 'storage'> = {},
): void {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const existing = readIntent(storage);
  if (existing?.clientRequestId === clientRequestId) removeIntent(storage);
}

export const submissionIntentPolicy = {
  storageKey: INTENT_STORAGE_KEY,
  ttlMs: INTENT_TTL_MS,
} as const;
