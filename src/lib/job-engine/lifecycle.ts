import { randomUUID } from 'node:crypto';

import {
  aggregateGenerationStatus,
  createImageIfAbsent,
  getGenerationJob,
  getGenerationWithJobsAndImages,
  imageExists,
  markExpiredDispatchingJobOutcomeUnknown,
  persistLateProviderHandleForCancellation,
  tryClaimCancellingLease,
  tryClaimPollLease,
  tryClaimQueuedJobForDispatch,
  tryClaimStoringLease,
  updateGeneration,
  updateGenerationJob,
  updateGenerationJobIfLease,
  updateGenerationJobIfNotCancelled,
  type DbClient,
  type GenerationJob,
  type GenerationJobPhase,
  type GenerationStatus as DbGenerationStatus,
  type UpdateGenerationJobPatch,
} from '../db';
import { StorageError, type StorageDiagnostic } from '../errors';
import { getById } from '../providers';
import type {
  JobHandle,
  ProviderImageRef,
  ProviderRequestDisposition,
  SubmitResult,
} from '../providers';
import { MAX_PROVIDER_RETRY_AFTER_MS } from '../providers/types';
import * as storage from '../storage';
import { serializeSafeJobError } from './job-error';
import { parseRequestSnapshot } from './request-snapshot';
import {
  canTransitionJobPhase,
  keepMonotonicStatus,
  type AdvanceOutcome,
  type JobPhase,
} from './state-machine';
import {
  decideRetry,
  resetRetryState,
  type RetryOperation,
} from './retry-policy';
import type { GenerationStatus } from './types';

export type StoreImagesResult =
  { kind: 'ok'; count: number } | { kind: 'failed'; error: StorageError };

// Covers one outside call. A recovery worker must never replay an expired
// dispatch lease because Provider acceptance is no longer knowable then.
export const POLL_LEASE_MS = 300_000;
export const POLL_INTERVAL_MS = 5_000;
/** @deprecated This is the successful-poll cadence, not a failure backoff. */
export const POLL_RETRY_DELAY_MS = POLL_INTERVAL_MS;
const MAX_RESULT_SNAPSHOT_BYTES = 128 * 1_024;
const MAX_RESULT_URL_LENGTH = 8 * 1_024;
const MAX_RESULT_CONTENT_TYPE_LENGTH = 256;
const PROVIDER_RATE_LIMIT_RETRY_MS = 5_000;

type LifecyclePatch = UpdateGenerationJobPatch & {
  status: GenerationStatus;
  phase?: GenerationJobPhase;
};

function nowIso(): string {
  return new Date().toISOString();
}

function nextPollAt(): string {
  return new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
}

function jobDiagnostic(
  code: string,
  _message: string,
  retryable = false,
  storageDiagnostic?: StorageDiagnostic,
): string {
  return serializeSafeJobError(
    code,
    retryable,
    'INTERNAL_ERROR',
    undefined,
    storageDiagnostic,
  );
}

function safeRecordValue(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

/**
 * Provider error messages are untrusted diagnostic data. Persist only the
 * allowlisted code and the provider's explicit retryability decision; never
 * copy its message, response body, prompt, URL, or arbitrary extra fields.
 */
function providerFailureDiagnostic(error: unknown): {
  diagnostic: string;
  retryable: boolean;
  code?: string;
  disposition?: ProviderRequestDisposition;
  retryAfterMs?: number;
} {
  if (
    typeof error !== 'object' ||
    error === null ||
    Array.isArray(error) ||
    typeof safeRecordValue(error, 'retryable') !== 'boolean'
  ) {
    return {
      diagnostic: serializeSafeJobError(
        'PROVIDER_ERROR',
        false,
        'PROVIDER_ERROR',
      ),
      retryable: false,
    };
  }
  const retryable = safeRecordValue(error, 'retryable') as boolean;
  const disposition = safeRecordValue(error, 'disposition');
  const retryAfterMs = safeRecordValue(error, 'retryAfterMs');
  const code = safeRecordValue(error, 'code');
  const providerDiagnostic = safeRecordValue(error, 'diagnostic');
  return {
    diagnostic: serializeSafeJobError(
      safeRecordValue(error, 'code'),
      retryable,
      'PROVIDER_ERROR',
      providerDiagnostic,
    ),
    retryable,
    ...(typeof code === 'string' ? { code } : {}),
    ...(disposition === 'not_started' ||
    disposition === 'rejected' ||
    disposition === 'unknown'
      ? { disposition }
      : {}),
    ...(typeof retryAfterMs === 'number' &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs >= 0
      ? { retryAfterMs: Math.min(MAX_PROVIDER_RETRY_AFTER_MS, Math.ceil(retryAfterMs)) }
      : {}),
  };
}

type NormalizedPollResult =
  | { status: 'pending' }
  | { status: 'running' }
  | { status: 'completed'; images: unknown[] | null }
  | {
      status: 'failed';
      error: {
        code: unknown;
        retryable: unknown;
        disposition: unknown;
        retryAfterMs: unknown;
        diagnostic: unknown;
      };
    }
  | { status: 'cancelled' };

function normalizeProviderImageRefs(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  try {
    return Array.from(value, (image) => {
      if (typeof image !== 'object' || image === null || Array.isArray(image)) {
        return image;
      }
      return {
        url: safeRecordValue(image, 'url'),
        width: safeRecordValue(image, 'width'),
        height: safeRecordValue(image, 'height'),
        contentType: safeRecordValue(image, 'contentType'),
        index: safeRecordValue(image, 'index'),
      };
    });
  } catch {
    return null;
  }
}

/**
 * Adapter TypeScript types cannot protect the durable worker from a malformed
 * runtime response. Read each Provider-owned field once into a plain snapshot
 * so an exception/stateful getter cannot throw after the lease was claimed.
 */
function normalizePollResult(value: unknown): NormalizedPollResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  switch (safeRecordValue(value, 'status')) {
    case 'pending':
      return { status: 'pending' };
    case 'running':
      return { status: 'running' };
    case 'completed':
      return {
        status: 'completed',
        images: normalizeProviderImageRefs(safeRecordValue(value, 'images')),
      };
    case 'failed':
      {
        const error = safeRecordValue(value, 'error');
        return {
          status: 'failed',
          error:
            typeof error === 'object' && error !== null && !Array.isArray(error)
              ? {
                  code: safeRecordValue(error, 'code'),
                  retryable: safeRecordValue(error, 'retryable'),
                  disposition: safeRecordValue(error, 'disposition'),
                  retryAfterMs: safeRecordValue(error, 'retryAfterMs'),
                  diagnostic: safeRecordValue(error, 'diagnostic'),
                }
              : {
                  code: undefined,
                  retryable: undefined,
                  disposition: undefined,
                  retryAfterMs: undefined,
                  diagnostic: undefined,
                },
        };
      }
    case 'cancelled':
      return { status: 'cancelled' };
    default:
      return null;
  }
}

function normalizePhase(value: string): JobPhase {
  switch (value) {
    case 'queued':
    case 'dispatching':
    case 'polling':
    case 'storing':
    case 'cancelling':
    case 'terminal':
    case 'outcome_unknown':
      return value;
    default:
      return 'outcome_unknown';
  }
}

function deriveGenerationStatus(
  generationId: string,
  client: DbClient,
): DbGenerationStatus {
  const generation = getGenerationWithJobsAndImages(generationId, client);
  if (!generation) return 'failed';
  return aggregateGenerationStatus(generation.jobs);
}

function nextMonotonicPatch(
  current: GenerationJob,
  patch: LifecyclePatch,
): LifecyclePatch | null {
  const from = normalizePhase(current.phase);
  const to = patch.phase === undefined ? from : normalizePhase(patch.phase);
  if (!canTransitionJobPhase(from, to)) return null;
  return {
    ...patch,
    phase: to,
    status: keepMonotonicStatus(
      current.status as GenerationStatus,
      patch.status,
    ),
  };
}

/**
 * Applies a lifecycle write together with Generation aggregation. When a
 * lease is supplied, it is also the compare-and-swap token for external work.
 */
export function updateJobAndGeneration(
  jobId: string,
  generationId: string,
  jobPatch: LifecyclePatch,
  client: DbClient,
  expectedPollLeaseUntil?: string,
  options: {
    expectedPhase?: GenerationJobPhase;
    allowCancellation?: boolean;
  } = {},
): boolean {
  let updated = false;
  client.transaction((tx) => {
    const current = getGenerationJob(jobId, tx);
    if (!current) return;
    const normalized = nextMonotonicPatch(current, jobPatch);
    if (!normalized) return;
    updated = expectedPollLeaseUntil
      ? updateGenerationJobIfLease(
          jobId,
          expectedPollLeaseUntil,
          normalized,
          tx,
          {
            expectedPhase: options.expectedPhase ?? normalized.phase,
            allowCancellation: options.allowCancellation,
          },
        )
      : (updateGenerationJob(jobId, normalized, tx), true);
    if (!updated) return;
    updateGeneration(
      generationId,
      {
        status: deriveGenerationStatus(generationId, tx),
        updatedAt: normalized.updatedAt,
      },
      tx,
    );
  });
  return updated;
}

/** Applies submit results only if local cancellation has not already won. */
export function updateJobAndGenerationIfNotCancelled(
  jobId: string,
  generationId: string,
  jobPatch: LifecyclePatch,
  client: DbClient,
): boolean {
  let updated = false;
  client.transaction((tx) => {
    const current = getGenerationJob(jobId, tx);
    if (!current) return;
    const normalized = nextMonotonicPatch(current, jobPatch);
    if (!normalized) return;
    updated = updateGenerationJobIfNotCancelled(jobId, normalized, tx);
    if (!updated) return;
    updateGeneration(
      generationId,
      {
        status: deriveGenerationStatus(generationId, tx),
        updatedAt: normalized.updatedAt,
      },
      tx,
    );
  });
  return updated;
}

export function syncGenerationStatus(
  generationId: string,
  client: DbClient,
): void {
  updateGeneration(
    generationId,
    {
      status: deriveGenerationStatus(generationId, client),
      updatedAt: nowIso(),
    },
    client,
  );
}

export async function storeImages(
  jobId: string,
  images: ProviderImageRef[],
  client: DbClient,
): Promise<StoreImagesResult> {
  const storedIndexes: number[] = [];
  for (const ref of images) {
    if (imageExists(jobId, ref.index, client)) {
      storedIndexes.push(ref.index);
      continue;
    }
    let result: Awaited<ReturnType<typeof storage.downloadAndStore>>;
    try {
      result = await storage.downloadAndStore(ref.url);
    } catch (err) {
      const error =
        err instanceof StorageError
          ? err
          : new StorageError('Generated image could not be stored', { cause: err });
      return { kind: 'failed', error };
    }
    const inserted = createImageIfAbsent(
      {
        id: randomUUID(),
        jobId,
        index: ref.index,
        storagePath: result.storagePath,
        contentType: result.contentType,
        width: ref.width,
        height: ref.height,
        sizeBytes: result.sizeBytes,
        createdAt: nowIso(),
      },
      client,
    );
    if (!inserted) {
      try {
        storage.removeStoredFile(result.storagePath);
      } catch {
        // The existing unique image row remains authoritative.
      }
    }
    storedIndexes.push(ref.index);
  }
  return { kind: 'ok', count: storedIndexes.length };
}

/** Legacy-compatible helper used by focused unit tests and direct callers. */
export async function completeSync(
  generationId: string,
  jobId: string,
  images: ProviderImageRef[],
  client: DbClient,
  expectedPollLeaseUntil?: string,
): Promise<void> {
  const current = getGenerationJob(jobId, client);
  if (!current || current.status === 'cancelled' || current.cancelRequestedAt)
    return;
  const result = await storeImages(jobId, images, client);
  const updatedAt = nowIso();
  updateJobAndGeneration(
    jobId,
    generationId,
    result.kind === 'ok'
      ? {
          status: 'completed',
          phase: 'terminal',
          pollLeaseUntil: null,
          nextPollAt: null,
          resultSnapshot: null,
          requestSnapshot: null,
          requestSnapshotVersion: null,
          ...resetRetryState(),
          updatedAt,
        }
      : {
          status: 'failed',
          phase: 'terminal',
          error: jobDiagnostic(
            'STORAGE_ERROR',
            'Generated image could not be stored',
            false,
            result.error.diagnostic,
          ),
          pollLeaseUntil: null,
          nextPollAt: null,
          resultSnapshot: null,
          requestSnapshot: null,
          requestSnapshotVersion: null,
          ...resetRetryState(),
          updatedAt,
        },
    client,
    expectedPollLeaseUntil,
    { expectedPhase: normalizePhase(current.phase) },
  );
}

function imageRefSnapshot(refs: ProviderImageRef[]): string {
  const snapshot = JSON.stringify(
    refs.map((ref) => ({
      url: ref.url,
      width: ref.width,
      height: ref.height,
      contentType: ref.contentType,
      index: ref.index,
    })),
  );
  if (
    new TextEncoder().encode(snapshot).byteLength > MAX_RESULT_SNAPSHOT_BYTES
  ) {
    throw new Error('Result snapshot exceeds its limit');
  }
  return snapshot;
}

function isInlineImageDataUrl(value: unknown): boolean {
  return typeof value === 'string' && /^\s*data:/i.test(value);
}

function isPersistableImageRefUrl(value: unknown): value is string {
  return (
    storage.isStagedImageRef(value) ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_RESULT_URL_LENGTH &&
      !isInlineImageDataUrl(value))
  );
}

function isResultImageCandidateUrl(value: unknown): value is string {
  return isPersistableImageRefUrl(value) || isInlineImageDataUrl(value);
}

function stagedReferencesFromSnapshot(serialized: string | null): string[] {
  if (
    !serialized ||
    new TextEncoder().encode(serialized).byteLength > MAX_RESULT_SNAPSHOT_BYTES
  ) {
    return [];
  }
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value))
            return [];
          const reference = (value as Record<string, unknown>).url;
          return storage.isStagedImageRef(reference) ? [reference] : [];
        }),
      ),
    ];
  } catch {
    return [];
  }
}

function cleanupStagedReferences(references: readonly string[]): void {
  for (const reference of references) {
    try {
      storage.removeStagedImage(reference);
    } catch {
      // The durable state remains correct; E3 adds staged-file reconciliation.
    }
  }
}

export function cleanupStagedResultSnapshot(serialized: string | null): void {
  cleanupStagedReferences(stagedReferencesFromSnapshot(serialized));
}

function stageInlineResultRefs(refs: ProviderImageRef[]): ProviderImageRef[] {
  const stagedReferences: string[] = [];
  try {
    return refs.map((ref) => {
      if (!isInlineImageDataUrl(ref.url)) return ref;
      const staged = storage.stageInlineImage(ref.url.trim(), ref.contentType);
      stagedReferences.push(staged.reference);
      return {
        ...ref,
        url: staged.reference,
        contentType: staged.contentType,
      };
    });
  } catch (cause) {
    cleanupStagedReferences(stagedReferences);
    throw cause;
  }
}

function parseImageRefSnapshot(serialized: string | null): ProviderImageRef[] {
  if (
    !serialized ||
    new TextEncoder().encode(serialized).byteLength > MAX_RESULT_SNAPSHOT_BYTES
  ) {
    throw new Error('Missing result snapshot');
  }
  const parsed = JSON.parse(serialized) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 32) {
    throw new Error('Invalid result snapshot');
  }
  return parsed.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid result snapshot');
    }
    const record = value as Record<string, unknown>;
    if (
      !isPersistableImageRefUrl(record.url) ||
      !Number.isInteger(record.index) ||
      (record.width !== null && !Number.isInteger(record.width)) ||
      (record.height !== null && !Number.isInteger(record.height)) ||
      typeof record.contentType !== 'string' ||
      record.contentType.length > MAX_RESULT_CONTENT_TYPE_LENGTH
    ) {
      throw new Error('Invalid result snapshot');
    }
    return {
      url: record.url,
      width: record.width as number | null,
      height: record.height as number | null,
      contentType: record.contentType,
      index: record.index as number,
    };
  });
}

function boundedImageRefs(
  images: unknown,
  requestedCount: number,
): ProviderImageRef[] {
  if (!Array.isArray(images)) return [];
  const unique = new Map<number, ProviderImageRef>();
  for (const image of images) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) continue;
    const candidate = image as Record<string, unknown>;
    const { url, width, height, contentType, index } = candidate;
    if (
      typeof index === 'number' &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < requestedCount &&
      !unique.has(index) &&
      isResultImageCandidateUrl(url) &&
      typeof contentType === 'string' &&
      contentType.length <= MAX_RESULT_CONTENT_TYPE_LENGTH &&
      (width === null ||
        (typeof width === 'number' && Number.isInteger(width))) &&
      (height === null ||
        (typeof height === 'number' && Number.isInteger(height)))
    ) {
      unique.set(index, {
        url,
        width,
        height,
        contentType,
        index,
      });
    }
  }
  return [...unique.values()].sort((left, right) => left.index - right.index);
}

function applyTerminalFailure(
  job: GenerationJob,
  error: string,
  client: DbClient,
  expectedPollLeaseUntil?: string,
  expectedPhase?: GenerationJobPhase,
): boolean {
  const applied = updateJobAndGeneration(
    job.id,
    job.generationId,
    {
      status: 'failed',
      phase: 'terminal',
      error,
      pollLeaseUntil: null,
      nextPollAt: null,
      resultSnapshot: null,
      requestSnapshot: null,
      requestSnapshotVersion: null,
      ...resetRetryState(),
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    { expectedPhase },
  );
  if (applied) cleanupStagedResultSnapshot(job.resultSnapshot);
  return applied;
}

function finishCancelledBeforeDispatch(
  job: GenerationJob,
  client: DbClient,
  expectedPollLeaseUntil: string,
): boolean {
  return finishCancellation(job, client, expectedPollLeaseUntil, null);
}

function finishCancellation(
  job: GenerationJob,
  client: DbClient,
  expectedPollLeaseUntil: string,
  error: string | null,
): boolean {
  const applied = updateJobAndGeneration(
    job.id,
    job.generationId,
    {
      status: 'cancelled',
      phase: 'terminal',
      error,
      pollLeaseUntil: null,
      nextPollAt: null,
      resultSnapshot: null,
      requestSnapshot: null,
      requestSnapshotVersion: null,
      ...resetRetryState(),
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    { expectedPhase: 'cancelling', allowCancellation: true },
  );
  if (applied) cleanupStagedResultSnapshot(job.resultSnapshot);
  return applied;
}

/**
 * Poll/cancel target durable handles. Submit joins this path only after an
 * explicit not-started/rejected classification; ambiguous submits never do.
 */
function scheduleRetryOrFinish(
  job: GenerationJob,
  operation: RetryOperation,
  error: string,
  client: DbClient,
  expectedPollLeaseUntil: string,
  minimumDelayMs?: number,
): AdvanceOutcome {
  const decision = decideRetry(operation, {
    attemptCount: job.attemptCount,
    retryStartedAt: job.retryStartedAt,
  }, { minimumDelayMs });
  const expectedPhase: GenerationJobPhase =
    operation === 'submit'
      ? 'dispatching'
      : operation === 'poll'
        ? 'polling'
        : operation === 'cancel'
          ? 'cancelling'
          : 'storing';

  if (decision.kind === 'exhausted') {
    const exhausted = jobDiagnostic(
      'RETRY_EXHAUSTED',
      `${operation === 'submit'
        ? 'Provider submit'
        : operation === 'poll'
          ? 'Provider poll'
          : operation === 'cancel'
            ? 'Remote cancellation'
            : 'Image download'} retry budget was exhausted (${decision.reason})`,
      false,
    );
    if (operation === 'cancel') {
      return finishCancellation(job, client, expectedPollLeaseUntil, exhausted)
        ? 'cancelled'
        : 'skipped';
    }
    return applyTerminalFailure(
      job,
      exhausted,
      client,
      expectedPollLeaseUntil,
      expectedPhase,
    )
      ? 'failed'
      : 'skipped';
  }

  const applied = updateJobAndGeneration(
    job.id,
    job.generationId,
    {
      status:
        operation === 'cancel' ? 'cancelled' : (job.status as GenerationStatus),
      // A verified pre-send/rejected submit returns to the durable queue so a
      // fresh dispatch lease is recorded before its next Provider call.
      phase: operation === 'submit' ? 'queued' : expectedPhase,
      error,
      pollLeaseUntil: null,
      nextPollAt: decision.nextAttemptAt,
      attemptCount: decision.attemptCount,
      retryStartedAt: decision.retryStartedAt,
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    {
      expectedPhase,
      allowCancellation: operation === 'cancel',
    },
  );
  return applied ? 'retried' : 'skipped';
}

/**
 * Explicit provider throttling is durable back-pressure, not a bounded error
 * budget. Keep the job active until the provider accepts it or the user
 * cancels; ambiguous submit outcomes never enter this path.
 */
function scheduleProviderRateLimitWait(
  job: GenerationJob,
  operation: 'submit' | 'poll',
  error: string,
  client: DbClient,
  expectedPollLeaseUntil: string,
  minimumDelayMs?: number,
): AdvanceOutcome {
  const expectedPhase: GenerationJobPhase =
    operation === 'submit' ? 'dispatching' : 'polling';
  const delayMs = Math.max(
    PROVIDER_RATE_LIMIT_RETRY_MS,
    minimumDelayMs ?? 0,
  );
  const applied = updateJobAndGeneration(
    job.id,
    job.generationId,
    {
      status: job.status as GenerationStatus,
      phase: operation === 'submit' ? 'queued' : 'polling',
      error,
      pollLeaseUntil: null,
      nextPollAt: new Date(Date.now() + delayMs).toISOString(),
      ...resetRetryState(),
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    { expectedPhase },
  );
  return applied ? 'retried' : 'skipped';
}

function isCurrentDispatchLease(
  jobId: string,
  expectedPollLeaseUntil: string,
  client: DbClient,
): boolean {
  const current = getGenerationJob(jobId, client);
  return (
    current?.phase === 'dispatching' &&
    current.status === 'pending' &&
    current.cancelRequestedAt === null &&
    current.pollLeaseUntil === expectedPollLeaseUntil
  );
}

function removeUncommittedStoredFile(storagePath: string): void {
  try {
    storage.removeStoredFile(storagePath);
  } catch {
    // A cleanup failure is secondary to the durable state transition. Batch E
    // adds structured reconciliation for storage failures and orphan scans.
  }
}

type StoredImageCommit = {
  accepted: boolean;
  inserted: boolean;
  completed: boolean;
};

/**
 * The file is already on local disk at this point. This short transaction
 * first proves ownership of the storage lease, then inserts its row and moves
 * the durable lifecycle forward. A concurrent cancellation therefore wins
 * before any image row becomes observable, or after this whole checkpoint has
 * already committed (where keeping the already-stored image is correct).
 */
function commitStoredImageAttempt(
  job: GenerationJob,
  refs: ProviderImageRef[],
  next: ProviderImageRef,
  stored: Awaited<ReturnType<typeof storage.downloadAndStore>>,
  imageId: string,
  expectedPollLeaseUntil: string,
  client: DbClient,
): StoredImageCommit {
  let result: StoredImageCommit = {
    accepted: false,
    inserted: false,
    completed: false,
  };
  client.transaction((tx) => {
    const checkpointAt = nowIso();
    // This conditional write is the serialization point with cancellation.
    // It keeps the same lease token but takes SQLite's write lock before an
    // image row can be inserted.
    if (
      !updateGenerationJobIfLease(
        job.id,
        expectedPollLeaseUntil,
        { updatedAt: checkpointAt },
        tx,
        { expectedPhase: 'storing' },
      )
    ) {
      return;
    }
    const inserted = createImageIfAbsent(
      {
        id: imageId,
        jobId: job.id,
        index: next.index,
        storagePath: stored.storagePath,
        contentType: stored.contentType,
        width: next.width,
        height: next.height,
        sizeBytes: stored.sizeBytes,
        createdAt: checkpointAt,
      },
      tx,
    );
    const hasMore = refs.some((ref) => !imageExists(job.id, ref.index, tx));
    const nextPatch: UpdateGenerationJobPatch = hasMore
      ? {
          status: 'running',
          phase: 'storing',
          pollLeaseUntil: null,
          nextPollAt: checkpointAt,
          ...resetRetryState(),
          updatedAt: checkpointAt,
        }
      : {
          status: 'completed',
          phase: 'terminal',
          pollLeaseUntil: null,
          nextPollAt: null,
          resultSnapshot: null,
          requestSnapshot: null,
          requestSnapshotVersion: null,
          ...resetRetryState(),
          updatedAt: checkpointAt,
        };
    if (
      !updateGenerationJobIfLease(
        job.id,
        expectedPollLeaseUntil,
        nextPatch,
        tx,
        { expectedPhase: 'storing' },
      )
    ) {
      throw new Error('Stored image checkpoint lost its lease unexpectedly');
    }
    updateGeneration(
      job.generationId,
      {
        status: deriveGenerationStatus(job.generationId, tx),
        updatedAt: checkpointAt,
      },
      tx,
    );
    result = { accepted: true, inserted, completed: !hasMore };
  });
  return result;
}

function applyOutcomeUnknown(job: GenerationJob, client: DbClient): boolean {
  const changed = markExpiredDispatchingJobOutcomeUnknown(
    job.id,
    nowIso(),
    jobDiagnostic(
      'PROVIDER_OUTCOME_UNKNOWN',
      'Dispatch lease expired before a durable provider result was recorded',
      false,
    ),
    client,
  );
  if (changed) syncGenerationStatus(job.generationId, client);
  return changed;
}

/** Records an ambiguous submit while its dispatch lease is still current. */
function applyDispatchOutcomeUnknown(
  job: GenerationJob,
  client: DbClient,
  expectedPollLeaseUntil: string,
): boolean {
  return updateJobAndGeneration(
    job.id,
    job.generationId,
    {
      status: 'failed',
      phase: 'outcome_unknown',
      error: jobDiagnostic(
        'PROVIDER_OUTCOME_UNKNOWN',
        'Provider dispatch outcome is unknown',
        false,
      ),
      pollLeaseUntil: null,
      nextPollAt: null,
      resultSnapshot: null,
      requestSnapshot: null,
      requestSnapshotVersion: null,
      ...resetRetryState(),
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    { expectedPhase: 'dispatching' },
  );
}

async function persistProviderImages(
  job: GenerationJob,
  images: unknown,
  client: DbClient,
  expectedPollLeaseUntil: string,
  expectedPhase: GenerationJobPhase,
): Promise<AdvanceOutcome> {
  // Adapter typings are not a security or reliability boundary. A malformed
  // provider response must become a durable safe failure, never escape the
  // worker and leave a due job permanently pending.
  const rawImages = normalizeProviderImageRefs(images);
  if (rawImages === null) {
    return applyTerminalFailure(
      job,
      jobDiagnostic(
        'STORAGE_RESPONSE_INVALID',
        'Provider returned an invalid image result',
      ),
      client,
      expectedPollLeaseUntil,
      expectedPhase,
    )
      ? 'failed'
      : 'skipped';
  }
  let requestedCount = 1;
  try {
    requestedCount =
      parseRequestSnapshot(job.requestSnapshot, job.requestSnapshotVersion)
        .count ?? 1;
  } catch {
    // v2 jobs that already hold an async handle are intentionally recoverable
    // after the v3 migration even though they never had a request snapshot.
    if (
      expectedPhase === 'polling' &&
      job.requestSnapshot === null &&
      job.requestSnapshotVersion === null
    ) {
      requestedCount = Math.min(Math.max(rawImages.length, 1), 32);
    } else {
      return applyTerminalFailure(
        job,
        jobDiagnostic(
          'INTERNAL_ERROR',
          'Stored generation request could not be recovered',
        ),
        client,
        expectedPollLeaseUntil,
        expectedPhase,
      )
        ? 'failed'
        : 'skipped';
    }
  }
  const candidates = boundedImageRefs(rawImages, requestedCount);
  if (candidates.length === 0) {
    return applyTerminalFailure(
      job,
      jobDiagnostic(
        rawImages.length > 0
          ? 'STORAGE_RESPONSE_INVALID'
          : 'PROVIDER_EMPTY_RESULT',
        rawImages.length > 0
          ? 'Provider returned an invalid image result'
          : 'Provider returned no image references',
      ),
      client,
      expectedPollLeaseUntil,
      expectedPhase,
    )
      ? 'failed'
      : 'skipped';
  }
  let refs: ProviderImageRef[];
  try {
    refs = stageInlineResultRefs(candidates);
  } catch {
    return applyTerminalFailure(
      job,
      jobDiagnostic(
        'STORAGE_RESPONSE_INVALID',
        'Provider returned an invalid inline image result',
      ),
      client,
      expectedPollLeaseUntil,
      expectedPhase,
    )
      ? 'failed'
      : 'skipped';
  }
  const warning =
    refs.length < requestedCount
      ? jobDiagnostic(
          'PROVIDER_PARTIAL_RESULT',
          'Provider returned fewer images than requested',
          false,
        )
      : null;
  let resultSnapshot: string;
  try {
    resultSnapshot = imageRefSnapshot(refs);
  } catch {
    cleanupStagedReferences(
      refs
        .filter((ref) => storage.isStagedImageRef(ref.url))
        .map((ref) => ref.url),
    );
    return applyTerminalFailure(
      job,
      jobDiagnostic(
        'STORAGE_RESPONSE_INVALID',
        'Provider returned an oversized image result',
      ),
      client,
      expectedPollLeaseUntil,
      expectedPhase,
    )
      ? 'failed'
      : 'skipped';
  }
  const applied = updateJobAndGeneration(
    job.id,
    job.generationId,
    {
      status: 'running',
      phase: 'storing',
      resultSnapshot,
      error: warning,
      pollLeaseUntil: null,
      nextPollAt: nowIso(),
      ...resetRetryState(),
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    { expectedPhase },
  );
  if (!applied) {
    cleanupStagedReferences(
      refs
        .filter((ref) => storage.isStagedImageRef(ref.url))
        .map((ref) => ref.url),
    );
  }
  return applied ? 'advanced' : 'skipped';
}

async function dispatchQueuedJob(
  job: GenerationJob,
  client: DbClient,
): Promise<AdvanceOutcome> {
  const now = new Date();
  const claimedUntil = new Date(now.getTime() + POLL_LEASE_MS).toISOString();
  if (
    !tryClaimQueuedJobForDispatch(
      job.id,
      now.toISOString(),
      claimedUntil,
      client,
    )
  ) {
    return 'skipped';
  }
  const claimed = getGenerationJob(job.id, client);
  if (!claimed) return 'skipped';

  let request;
  try {
    request = parseRequestSnapshot(
      claimed.requestSnapshot,
      claimed.requestSnapshotVersion,
    );
  } catch {
    return applyTerminalFailure(
      claimed,
      jobDiagnostic(
        'INTERNAL_ERROR',
        'Stored generation request could not be recovered',
      ),
      client,
      claimedUntil,
      'dispatching',
    )
      ? 'failed'
      : 'skipped';
  }
  const provider = getById(claimed.provider as Parameters<typeof getById>[0]);
  if (!provider) {
    return applyTerminalFailure(
      claimed,
      jobDiagnostic('PROVIDER_NOT_FOUND', 'Configured provider is unavailable'),
      client,
      claimedUntil,
      'dispatching',
    )
      ? 'failed'
      : 'skipped';
  }

  let result: SubmitResult | null;
  try {
    // Cancellation can commit after the dispatch lease is claimed but before
    // the external call begins. Recheck immediately before the billable call.
    result = isCurrentDispatchLease(claimed.id, claimedUntil, client)
      ? await provider.submit(request, claimed.model)
      : null;
  } catch {
    // Once the task started, a local throw cannot prove that the provider did
    // not receive the request. Never turn generic throw/rejection into a
    // replayable submit.
    return applyDispatchOutcomeUnknown(claimed, client, claimedUntil)
      ? 'unknown'
      : 'skipped';
  }

  if (result === null) {
    const cancelled = getGenerationJob(claimed.id, client);
    return cancelled?.phase === 'cancelling' &&
      cancelled.cancelRequestedAt !== null &&
      cancelled.pollLeaseUntil === claimedUntil &&
      finishCancelledBeforeDispatch(claimed, client, claimedUntil)
      ? 'cancelled'
      : 'skipped';
  }

  switch (result.kind) {
    case 'async': {
      const applied = updateJobAndGeneration(
        claimed.id,
        claimed.generationId,
        {
          status: 'pending',
          phase: 'polling',
          providerHandle: JSON.stringify(result.handle),
          error: null,
          pollLeaseUntil: null,
          nextPollAt: nowIso(),
          ...resetRetryState(),
          updatedAt: nowIso(),
        },
        client,
        claimedUntil,
        { expectedPhase: 'dispatching' },
      );
      if (applied) return 'advanced';
      return persistLateProviderHandleForCancellation(
        claimed.id,
        JSON.stringify(result.handle),
        claimedUntil,
        nowIso(),
        client,
      )
        ? 'advanced'
        : 'skipped';
    }
    case 'sync':
      return persistProviderImages(
        claimed,
        result.images,
        client,
        claimedUntil,
        'dispatching',
      );
    case 'failed': {
      const failure = providerFailureDiagnostic(result.error);
      if (
        failure.retryable &&
        (failure.disposition === 'not_started' ||
          failure.disposition === 'rejected')
      ) {
        if (failure.code === 'RATE_LIMITED') {
          return scheduleProviderRateLimitWait(
            claimed,
            'submit',
            failure.diagnostic,
            client,
            claimedUntil,
            failure.retryAfterMs,
          );
        }
        return scheduleRetryOrFinish(
          claimed,
          'submit',
          failure.diagnostic,
          client,
          claimedUntil,
          failure.retryAfterMs,
        );
      }
      if (failure.disposition === 'unknown') {
        return applyDispatchOutcomeUnknown(claimed, client, claimedUntil)
          ? 'unknown'
          : 'skipped';
      }
      return applyTerminalFailure(
        claimed,
        failure.diagnostic,
        client,
        claimedUntil,
        'dispatching',
      )
        ? 'failed'
        : 'skipped';
    }
  }
}

async function pollJob(
  job: GenerationJob,
  client: DbClient,
): Promise<AdvanceOutcome> {
  const now = new Date();
  const claimedUntil = new Date(now.getTime() + POLL_LEASE_MS).toISOString();
  if (!tryClaimPollLease(job.id, now.toISOString(), claimedUntil, client)) {
    return 'skipped';
  }
  const claimed = getGenerationJob(job.id, client);
  if (!claimed?.providerHandle) return 'skipped';
  let handle: JobHandle;
  try {
    handle = JSON.parse(claimed.providerHandle) as JobHandle;
  } catch {
    return applyTerminalFailure(
      claimed,
      jobDiagnostic('INVALID_HANDLE', 'Stored provider handle is invalid'),
      client,
      claimedUntil,
      'polling',
    )
      ? 'failed'
      : 'skipped';
  }
  const provider = getById(handle.providerId);
  if (!provider?.poll) {
    return applyTerminalFailure(
      claimed,
      jobDiagnostic(
        'PROVIDER_NOT_FOUND',
        'Configured provider cannot poll this job',
      ),
      client,
      claimedUntil,
      'polling',
    )
      ? 'failed'
      : 'skipped';
  }

  let providerResult: unknown;
  try {
    providerResult = await provider.poll(handle);
  } catch {
    return scheduleRetryOrFinish(
      claimed,
      'poll',
      jobDiagnostic('PROVIDER_ERROR', 'Provider poll failed', true),
      client,
      claimedUntil,
    );
  }
  const result = normalizePollResult(providerResult);
  if (!result) {
    return scheduleRetryOrFinish(
      claimed,
      'poll',
      jobDiagnostic('PROVIDER_ERROR', 'Provider returned an invalid poll result', true),
      client,
      claimedUntil,
    );
  }

  switch (result.status) {
    case 'pending': {
      const applied = updateJobAndGeneration(
        claimed.id,
        claimed.generationId,
        {
          status: keepMonotonicStatus(
            claimed.status as GenerationStatus,
            'pending',
          ),
          phase: 'polling',
          error: null,
          pollLeaseUntil: null,
          nextPollAt: nextPollAt(),
          ...resetRetryState(),
          updatedAt: nowIso(),
        },
        client,
        claimedUntil,
        { expectedPhase: 'polling' },
      );
      return applied ? 'advanced' : 'skipped';
    }
    case 'running': {
      const applied = updateJobAndGeneration(
        claimed.id,
        claimed.generationId,
        {
          status: 'running',
          phase: 'polling',
          error: null,
          pollLeaseUntil: null,
          nextPollAt: nextPollAt(),
          ...resetRetryState(),
          updatedAt: nowIso(),
        },
        client,
        claimedUntil,
        { expectedPhase: 'polling' },
      );
      return applied ? 'advanced' : 'skipped';
    }
    case 'completed':
      if (result.images === null) {
        return scheduleRetryOrFinish(
          claimed,
          'poll',
          jobDiagnostic(
            'PROVIDER_ERROR',
            'Provider returned an invalid completed result',
            true,
          ),
          client,
          claimedUntil,
        );
      }
      return persistProviderImages(
        claimed,
        result.images,
        client,
        claimedUntil,
        'polling',
      );
    case 'failed': {
      const failure = providerFailureDiagnostic(result.error);
      if (failure.retryable) {
        if (
          failure.code === 'RATE_LIMITED' &&
          (failure.disposition === 'not_started' ||
            failure.disposition === 'rejected')
        ) {
          return scheduleProviderRateLimitWait(
            claimed,
            'poll',
            failure.diagnostic,
            client,
            claimedUntil,
            failure.retryAfterMs,
          );
        }
        return scheduleRetryOrFinish(
          claimed,
          'poll',
          failure.diagnostic,
          client,
          claimedUntil,
          failure.retryAfterMs,
        );
      }
      return applyTerminalFailure(
        claimed,
        failure.diagnostic,
        client,
        claimedUntil,
        'polling',
      )
        ? 'failed'
        : 'skipped';
    }
    case 'cancelled': {
      const applied = updateJobAndGeneration(
        claimed.id,
        claimed.generationId,
        {
          status: 'cancelled',
          phase: 'terminal',
          error: null,
          pollLeaseUntil: null,
          nextPollAt: null,
          resultSnapshot: null,
          requestSnapshot: null,
          requestSnapshotVersion: null,
          ...resetRetryState(),
          updatedAt: nowIso(),
        },
        client,
        claimedUntil,
        { expectedPhase: 'polling' },
      );
      if (applied) cleanupStagedResultSnapshot(claimed.resultSnapshot);
      return applied ? 'cancelled' : 'skipped';
    }
  }
}

async function storeNextImage(
  job: GenerationJob,
  client: DbClient,
): Promise<AdvanceOutcome> {
  const now = new Date();
  const claimedUntil = new Date(now.getTime() + POLL_LEASE_MS).toISOString();
  if (!tryClaimStoringLease(job.id, now.toISOString(), claimedUntil, client)) {
    return 'skipped';
  }
  const claimed = getGenerationJob(job.id, client);
  if (!claimed) return 'skipped';
  let refs: ProviderImageRef[];
  try {
    refs = parseImageRefSnapshot(claimed.resultSnapshot);
  } catch {
    return applyTerminalFailure(
      claimed,
      jobDiagnostic(
        'STORAGE_RESPONSE_INVALID',
        'Stored image result is invalid',
      ),
      client,
      claimedUntil,
      'storing',
    )
      ? 'failed'
      : 'skipped';
  }
  const next = refs.find((ref) => !imageExists(claimed.id, ref.index, client));
  if (!next) {
    const completed = updateJobAndGeneration(
      claimed.id,
      claimed.generationId,
      {
        status: 'completed',
        phase: 'terminal',
        pollLeaseUntil: null,
        nextPollAt: null,
        resultSnapshot: null,
        requestSnapshot: null,
        requestSnapshotVersion: null,
        ...resetRetryState(),
        updatedAt: nowIso(),
      },
      client,
      claimedUntil,
      { expectedPhase: 'storing' },
    );
    if (completed) cleanupStagedResultSnapshot(claimed.resultSnapshot);
    return completed ? 'completed' : 'skipped';
  }
  let stored: Awaited<ReturnType<typeof storage.downloadAndStore>>;
  try {
    stored = await storage.downloadAndStore(next.url);
  } catch (err) {
    if (err instanceof StorageError && err.retryable) {
      return scheduleRetryOrFinish(
        claimed,
        'download',
        jobDiagnostic(
          'STORAGE_ERROR',
          'Image download temporarily failed',
          true,
          err.diagnostic,
        ),
        client,
        claimedUntil,
        err.retryAfterMs,
      );
    }
    return applyTerminalFailure(
      claimed,
      jobDiagnostic(
        'STORAGE_ERROR',
        'Image storage failed',
        false,
        err instanceof StorageError ? err.diagnostic : undefined,
      ),
      client,
      claimedUntil,
      'storing',
    )
      ? 'failed'
      : 'skipped';
  }
  const imageId = randomUUID();
  let committed: StoredImageCommit;
  try {
    committed = commitStoredImageAttempt(
      claimed,
      refs,
      next,
      stored,
      imageId,
      claimedUntil,
      client,
    );
  } catch {
    removeUncommittedStoredFile(stored.storagePath);
    return applyTerminalFailure(
      claimed,
      jobDiagnostic('STORAGE_ERROR', 'Image record could not be stored', false),
      client,
      claimedUntil,
      'storing',
    )
      ? 'failed'
      : 'skipped';
  }
  if (!committed.accepted || !committed.inserted) {
    // A cancellation/lease winner or duplicate row owns the outcome; this
    // attempt's file must never outlive its losing DB write.
    removeUncommittedStoredFile(stored.storagePath);
  }
  if (!committed.accepted) return 'skipped';
  if (storage.isStagedImageRef(next.url)) cleanupStagedReferences([next.url]);
  if (committed.completed) cleanupStagedResultSnapshot(claimed.resultSnapshot);
  return committed.completed ? 'completed' : 'advanced';
}

async function finishCancellingJob(
  job: GenerationJob,
  client: DbClient,
): Promise<AdvanceOutcome> {
  const now = new Date();
  const claimedUntil = new Date(now.getTime() + POLL_LEASE_MS).toISOString();
  if (
    !tryClaimCancellingLease(job.id, now.toISOString(), claimedUntil, client)
  ) {
    return 'skipped';
  }
  const claimed = getGenerationJob(job.id, client);
  if (!claimed) return 'skipped';
  if (!claimed.providerHandle) {
    return finishCancellation(claimed, client, claimedUntil, null)
      ? 'cancelled'
      : 'skipped';
  }

  let handle: JobHandle;
  try {
    handle = JSON.parse(claimed.providerHandle) as JobHandle;
  } catch {
    return finishCancellation(
      claimed,
      client,
      claimedUntil,
      jobDiagnostic('CANCEL_UNSUPPORTED', 'Stored provider handle is invalid'),
    )
      ? 'cancelled'
      : 'skipped';
  }
  const provider = getById(handle.providerId);
  if (!provider?.cancel) {
    return finishCancellation(
      claimed,
      client,
      claimedUntil,
      jobDiagnostic(
        'CANCEL_UNSUPPORTED',
        'Provider has no remote cancel endpoint',
      ),
    )
      ? 'cancelled'
      : 'skipped';
  }

  let providerResult: unknown;
  try {
    providerResult = await provider.cancel(handle);
  } catch {
    return scheduleRetryOrFinish(
      claimed,
      'cancel',
      jobDiagnostic(
        'PROVIDER_ERROR',
        'Remote cancellation could not be confirmed',
        true,
      ),
      client,
      claimedUntil,
    );
  }
  const result = normalizePollResult(providerResult);
  if (!result) {
    return scheduleRetryOrFinish(
      claimed,
      'cancel',
      jobDiagnostic(
        'PROVIDER_ERROR',
        'Provider returned an invalid cancellation result',
        true,
      ),
      client,
      claimedUntil,
    );
  }
  if (result.status === 'failed') {
    const failure = providerFailureDiagnostic(result.error);
    if (failure.retryable) {
      return scheduleRetryOrFinish(
        claimed,
        'cancel',
        failure.diagnostic,
        client,
        claimedUntil,
        failure.retryAfterMs,
      );
    }
    return finishCancellation(claimed, client, claimedUntil, failure.diagnostic)
      ? 'cancelled'
      : 'skipped';
  }
  if (result.status === 'cancelled') {
    return finishCancellation(claimed, client, claimedUntil, null)
      ? 'cancelled'
      : 'skipped';
  }
  if (result.status === 'pending' || result.status === 'running') {
    // A cancel endpoint may acknowledge the request before the remote job has
    // reached a cancelled state. Keep the local cancellation authoritative,
    // but consume the bounded cancellation budget until it is confirmed.
    return scheduleRetryOrFinish(
      claimed,
      'cancel',
      jobDiagnostic(
        'CANCEL_UNCONFIRMED',
        'Remote cancellation is still pending confirmation',
        true,
      ),
      client,
      claimedUntil,
    );
  }
  // A remote job may complete in the race with a local cancellation. Never
  // revive the public cancelled status or persist completed images here; make
  // the unconfirmed remote outcome visible as a safe terminal diagnostic.
  return finishCancellation(
    claimed,
    client,
    claimedUntil,
    jobDiagnostic(
      'CANCEL_UNCONFIRMED',
      'Remote job completed before cancellation could be confirmed',
      false,
    ),
  )
    ? 'cancelled'
    : 'skipped';
}

/** Advances exactly one durable phase. No route may call Provider APIs directly. */
export async function advance(
  input: GenerationJob,
  client: DbClient,
): Promise<AdvanceOutcome> {
  const job = getGenerationJob(input.id, client);
  if (!job) return 'skipped';
  const phase = normalizePhase(job.phase);
  switch (phase) {
    case 'queued':
      // Old rows with a handle may predate the phase migration and are safely
      // pollable. A new queued row without a snapshot must not be guessed.
      if (job.providerHandle) return pollJob(job, client);
      return dispatchQueuedJob(job, client);
    case 'dispatching':
      return applyOutcomeUnknown(job, client) ? 'unknown' : 'skipped';
    case 'polling':
      return pollJob(job, client);
    case 'storing':
      return storeNextImage(job, client);
    case 'cancelling':
      return finishCancellingJob(job, client);
    case 'terminal':
    case 'outcome_unknown':
      return 'skipped';
  }
}
