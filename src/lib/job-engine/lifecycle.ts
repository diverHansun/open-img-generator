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
import { StorageError } from '../errors';
import { getById } from '../providers';
import type {
  JobHandle,
  PollResult,
  ProviderImageRef,
  SubmitResult,
} from '../providers';
import { withProviderLimit } from '../providers/limiter';
import * as storage from '../storage';
import { parseRequestSnapshot } from './request-snapshot';
import {
  canTransitionJobPhase,
  keepMonotonicStatus,
  type AdvanceOutcome,
  type JobPhase,
} from './state-machine';
import type { GenerationStatus } from './types';

export type StoreImagesResult =
  | { kind: 'ok'; count: number }
  | { kind: 'failed'; error: StorageError };

// Covers one outside call. A recovery worker must never replay an expired
// dispatch lease because Provider acceptance is no longer knowable then.
export const POLL_LEASE_MS = 300_000;
export const POLL_RETRY_DELAY_MS = 5_000;
const MAX_RESULT_SNAPSHOT_BYTES = 128 * 1_024;
const MAX_RESULT_URL_LENGTH = 8 * 1_024;
const MAX_RESULT_CONTENT_TYPE_LENGTH = 256;

type LifecyclePatch = UpdateGenerationJobPatch & {
  status: GenerationStatus;
  phase?: GenerationJobPhase;
};

function nowIso(): string {
  return new Date().toISOString();
}

function retryAt(): string {
  return new Date(Date.now() + POLL_RETRY_DELAY_MS).toISOString();
}

function jobDiagnostic(
  code: string,
  message: string,
  retryable = false,
): string {
  return JSON.stringify({ code, message, retryable });
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
    updateGeneration(generationId, {
      status: deriveGenerationStatus(generationId, tx),
      updatedAt: normalized.updatedAt,
    }, tx);
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
    updateGeneration(generationId, {
      status: deriveGenerationStatus(generationId, tx),
      updatedAt: normalized.updatedAt,
    }, tx);
  });
  return updated;
}

export function syncGenerationStatus(
  generationId: string,
  client: DbClient,
): void {
  updateGeneration(
    generationId,
    { status: deriveGenerationStatus(generationId, client), updatedAt: nowIso() },
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
      const error = err instanceof StorageError
        ? err
        : new StorageError('Generated image could not be stored', err);
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
  if (!current || current.status === 'cancelled' || current.cancelRequestedAt) return;
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
          updatedAt,
        }
      : {
          status: 'failed',
          phase: 'terminal',
          error: jobDiagnostic('STORAGE_ERROR', result.error.message, false),
          pollLeaseUntil: null,
          nextPollAt: null,
          resultSnapshot: null,
          requestSnapshot: null,
          requestSnapshotVersion: null,
          updatedAt,
        },
    client,
    expectedPollLeaseUntil,
    { expectedPhase: normalizePhase(current.phase) },
  );
}

function imageRefSnapshot(refs: ProviderImageRef[]): string {
  const snapshot = JSON.stringify(refs.map((ref) => ({
    url: ref.url,
    width: ref.width,
    height: ref.height,
    contentType: ref.contentType,
    index: ref.index,
  })));
  if (new TextEncoder().encode(snapshot).byteLength > MAX_RESULT_SNAPSHOT_BYTES) {
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
    (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_RESULT_URL_LENGTH &&
      !isInlineImageDataUrl(value)
    )
  );
}

function isResultImageCandidateUrl(value: unknown): value is string {
  return isPersistableImageRefUrl(value) || isInlineImageDataUrl(value);
}

function stagedReferencesFromSnapshot(serialized: string | null): string[] {
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MAX_RESULT_SNAPSHOT_BYTES) {
    return [];
  }
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const reference = (value as Record<string, unknown>).url;
      return storage.isStagedImageRef(reference) ? [reference] : [];
    }))];
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
      (width === null || (typeof width === 'number' && Number.isInteger(width))) &&
      (height === null || (typeof height === 'number' && Number.isInteger(height)))
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
  const applied = updateJobAndGeneration(
    job.id,
    job.generationId,
    {
      status: 'cancelled',
      phase: 'terminal',
      pollLeaseUntil: null,
      nextPollAt: null,
      resultSnapshot: null,
      requestSnapshot: null,
      requestSnapshotVersion: null,
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    { expectedPhase: 'cancelling', allowCancellation: true },
  );
  if (applied) cleanupStagedResultSnapshot(job.resultSnapshot);
  return applied;
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
    if (!updateGenerationJobIfLease(
      job.id,
      expectedPollLeaseUntil,
      { updatedAt: checkpointAt },
      tx,
      { expectedPhase: 'storing' },
    )) {
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
          updatedAt: checkpointAt,
        };
    if (!updateGenerationJobIfLease(
      job.id,
      expectedPollLeaseUntil,
      nextPatch,
      tx,
      { expectedPhase: 'storing' },
    )) {
      throw new Error('Stored image checkpoint lost its lease unexpectedly');
    }
    updateGeneration(job.generationId, {
      status: deriveGenerationStatus(job.generationId, tx),
      updatedAt: checkpointAt,
    }, tx);
    result = { accepted: true, inserted, completed: !hasMore };
  });
  return result;
}

function applyOutcomeUnknown(
  job: GenerationJob,
  client: DbClient,
): boolean {
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

async function persistProviderImages(
  job: GenerationJob,
  images: ProviderImageRef[],
  client: DbClient,
  expectedPollLeaseUntil: string,
  expectedPhase: GenerationJobPhase,
): Promise<AdvanceOutcome> {
  // Adapter typings are not a security or reliability boundary. A malformed
  // provider response must become a durable safe failure, never escape the
  // worker and leave a due job permanently pending.
  const rawImages: unknown[] = Array.isArray(images) ? images : [];
  let requestedCount = 1;
  try {
    requestedCount = parseRequestSnapshot(
      job.requestSnapshot,
      job.requestSnapshotVersion,
    ).count ?? 1;
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
        jobDiagnostic('INTERNAL_ERROR', 'Stored generation request could not be recovered'),
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
      jobDiagnostic('STORAGE_RESPONSE_INVALID', 'Provider returned an invalid inline image result'),
      client,
      expectedPollLeaseUntil,
      expectedPhase,
    )
      ? 'failed'
      : 'skipped';
  }
  const warning = refs.length < requestedCount
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
    cleanupStagedReferences(refs.filter((ref) => storage.isStagedImageRef(ref.url)).map((ref) => ref.url));
    return applyTerminalFailure(
      job,
      jobDiagnostic('STORAGE_RESPONSE_INVALID', 'Provider returned an oversized image result'),
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
      updatedAt: nowIso(),
    },
    client,
    expectedPollLeaseUntil,
    { expectedPhase },
  );
  if (!applied) {
    cleanupStagedReferences(refs.filter((ref) => storage.isStagedImageRef(ref.url)).map((ref) => ref.url));
  }
  return applied ? 'advanced' : 'skipped';
}

async function dispatchQueuedJob(
  job: GenerationJob,
  client: DbClient,
): Promise<AdvanceOutcome> {
  const now = new Date();
  const claimedUntil = new Date(now.getTime() + POLL_LEASE_MS).toISOString();
  if (!tryClaimQueuedJobForDispatch(job.id, now.toISOString(), claimedUntil, client)) {
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
      jobDiagnostic('INTERNAL_ERROR', 'Stored generation request could not be recovered'),
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
    result = await withProviderLimit<SubmitResult | null>(provider.id, async () => {
      // This executes after a possible limiter wait. Do not start a new
      // billable request if cancellation committed while the work was queued.
      if (!isCurrentDispatchLease(claimed.id, claimedUntil, client)) return null;
      return provider.submit(request, claimed.model);
    });
  } catch (cause) {
    // Batch D deliberately treats a started request whose result is unknown as
    // non-replayable. Batch E will classify pre-send vs. remote outcomes.
    return updateJobAndGeneration(
      claimed.id,
      claimed.generationId,
      {
        status: 'failed',
        phase: 'outcome_unknown',
        error: jobDiagnostic(
          'PROVIDER_OUTCOME_UNKNOWN',
          cause instanceof Error ? cause.message : 'Provider dispatch outcome is unknown',
          false,
        ),
        pollLeaseUntil: null,
        nextPollAt: null,
        resultSnapshot: null,
        requestSnapshot: null,
        requestSnapshotVersion: null,
        updatedAt: nowIso(),
      },
      client,
      claimedUntil,
      { expectedPhase: 'dispatching' },
    )
      ? 'unknown'
      : 'skipped';
  }

  if (result === null) {
    const cancelled = getGenerationJob(claimed.id, client);
    return (
      cancelled?.phase === 'cancelling' &&
      cancelled.cancelRequestedAt !== null &&
      cancelled.pollLeaseUntil === claimedUntil &&
      finishCancelledBeforeDispatch(claimed, client, claimedUntil)
    )
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
          pollLeaseUntil: null,
          nextPollAt: nowIso(),
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
    case 'failed':
      return applyTerminalFailure(
        claimed,
        JSON.stringify(result.error),
        client,
        claimedUntil,
        'dispatching',
      )
        ? 'failed'
        : 'skipped';
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
      jobDiagnostic('PROVIDER_NOT_FOUND', 'Configured provider cannot poll this job'),
      client,
      claimedUntil,
      'polling',
    )
      ? 'failed'
      : 'skipped';
  }

  let result: PollResult;
  try {
    result = await withProviderLimit(provider.id, () => provider.poll!(handle));
  } catch (cause) {
    return applyTerminalFailure(
      claimed,
      jobDiagnostic(
        'PROVIDER_ERROR',
        cause instanceof Error ? cause.message : 'Provider poll failed',
        false,
      ),
      client,
      claimedUntil,
      'polling',
    )
      ? 'failed'
      : 'skipped';
  }

  switch (result.status) {
    case 'pending': {
      const applied = updateJobAndGeneration(
        claimed.id,
        claimed.generationId,
        {
          status: keepMonotonicStatus(claimed.status as GenerationStatus, 'pending'),
          phase: 'polling',
          pollLeaseUntil: null,
          nextPollAt: retryAt(),
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
          pollLeaseUntil: null,
          nextPollAt: retryAt(),
          updatedAt: nowIso(),
        },
        client,
        claimedUntil,
        { expectedPhase: 'polling' },
      );
      return applied ? 'advanced' : 'skipped';
    }
    case 'completed':
      return persistProviderImages(
        claimed,
        result.images,
        client,
        claimedUntil,
        'polling',
      );
    case 'failed':
      return applyTerminalFailure(
        claimed,
        JSON.stringify(result.error),
        client,
        claimedUntil,
        'polling',
      )
        ? 'failed'
        : 'skipped';
    case 'cancelled': {
      const applied = updateJobAndGeneration(
        claimed.id,
        claimed.generationId,
        {
          status: 'cancelled',
          phase: 'terminal',
          pollLeaseUntil: null,
          nextPollAt: null,
          resultSnapshot: null,
          requestSnapshot: null,
          requestSnapshotVersion: null,
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
      jobDiagnostic('STORAGE_RESPONSE_INVALID', 'Stored image result is invalid'),
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
  } catch (cause) {
    return applyTerminalFailure(
      claimed,
      jobDiagnostic(
        'STORAGE_ERROR',
        cause instanceof Error ? cause.message : 'Image storage failed',
        false,
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
  } catch (cause) {
    removeUncommittedStoredFile(stored.storagePath);
    return applyTerminalFailure(
      claimed,
      jobDiagnostic(
        'STORAGE_ERROR',
        cause instanceof Error ? cause.message : 'Image record could not be stored',
        false,
      ),
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
  if (!tryClaimCancellingLease(job.id, now.toISOString(), claimedUntil, client)) {
    return 'skipped';
  }
  const claimed = getGenerationJob(job.id, client);
  if (!claimed) return 'skipped';
  let error: string | null = null;
  if (claimed.providerHandle) {
    try {
      const handle = JSON.parse(claimed.providerHandle) as JobHandle;
      const provider = getById(handle.providerId);
      if (!provider?.cancel) {
        error = jobDiagnostic('CANCEL_UNSUPPORTED', 'Provider has no remote cancel endpoint');
      } else {
        const result = await withProviderLimit(provider.id, () => provider.cancel!(handle));
        if (result.status === 'failed') error = JSON.stringify(result.error);
      }
    } catch (cause) {
      error = jobDiagnostic(
        'CANCEL_UNSUPPORTED',
        cause instanceof Error ? cause.message : 'Remote cancellation could not be confirmed',
      );
    }
  }
  const applied = updateJobAndGeneration(
    claimed.id,
    claimed.generationId,
    {
      status: 'cancelled',
      phase: 'terminal',
      error,
      pollLeaseUntil: null,
      nextPollAt: null,
      resultSnapshot: null,
      requestSnapshot: null,
      requestSnapshotVersion: null,
      updatedAt: nowIso(),
    },
    client,
    claimedUntil,
    { expectedPhase: 'cancelling', allowCancellation: true },
  );
  if (applied) cleanupStagedResultSnapshot(claimed.resultSnapshot);
  return applied ? 'cancelled' : 'skipped';
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
