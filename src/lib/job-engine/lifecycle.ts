import { randomUUID } from 'node:crypto';
import {
  updateGenerationJob,
  updateGenerationJobIfLease,
  updateGeneration,
  createImageIfAbsent,
  imageExists,
  getGenerationWithJobsAndImages,
  aggregateGenerationStatus,
  tryClaimPollLease,
  type DbClient,
  type GenerationJob,
} from '../db';
import { getById } from '../providers';
import type { JobHandle, PollResult, ProviderImageRef } from '../providers';
import * as storage from '../storage';
import { StorageError } from '../errors';
import type { GenerationStatus } from './types';

export type StoreImagesResult =
  | { kind: 'ok'; count: number }
  | { kind: 'failed'; error: StorageError };

// Covers the full Fal completion path: status + response + image transfer.
// A crashed process may delay the next poll by at most this amount.
export const POLL_LEASE_MS = 300_000;

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
      const message = `Failed to store image at index ${ref.index}${storedIndexes.length > 0 ? ` (already stored indexes: ${storedIndexes.join(', ')})` : ''}`;
      const storageError =
        err instanceof StorageError ? err : new StorageError(message, err);
      return { kind: 'failed', error: storageError };
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
        createdAt: new Date().toISOString(),
      },
      client,
    );
    if (!inserted) {
      try {
        storage.removeStoredFile(result.storagePath);
      } catch {
        // Cleanup is best effort; the existing image row remains authoritative.
      }
    }
    storedIndexes.push(ref.index);
  }

  return { kind: 'ok', count: storedIndexes.length };
}

export async function completeSync(
  generationId: string,
  jobId: string,
  images: ProviderImageRef[],
  client: DbClient,
  expectedPollLeaseUntil?: string,
): Promise<void> {
  const storeResult = await storeImages(jobId, images, client);
  const now = new Date().toISOString();

  client.transaction((tx) => {
    const patch =
      storeResult.kind === 'ok'
        ? { status: 'completed' as const, pollLeaseUntil: null, updatedAt: now }
        : {
            status: 'failed' as const,
            error: JSON.stringify({
              code: 'STORAGE_ERROR',
              message: storeResult.error.message,
              retryable: false,
            }),
            pollLeaseUntil: null,
            updatedAt: now,
          };
    const updated = expectedPollLeaseUntil
      ? updateGenerationJobIfLease(jobId, expectedPollLeaseUntil, patch, tx)
      : (updateGenerationJob(jobId, patch, tx), true);
    if (!updated) return;

    const finalStatus = deriveGenerationStatus(generationId, tx);
    updateGeneration(
      generationId,
      { status: finalStatus, updatedAt: now },
      tx,
    );
  });
}

export async function advance(
  job: GenerationJob,
  client: DbClient,
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + POLL_LEASE_MS).toISOString();

  if (!tryClaimPollLease(job.id, nowIso, leaseUntil, client)) {
    return;
  }

  let handle: JobHandle;
  try {
    handle = JSON.parse(job.providerHandle ?? '{}') as JobHandle;
  } catch {
    updateJobAndGeneration(
      job.id,
      job.generationId,
      {
        status: 'failed',
        error: JSON.stringify({
          code: 'INVALID_HANDLE',
          message: 'Failed to parse provider handle',
          retryable: false,
        }),
        pollLeaseUntil: null,
        updatedAt: new Date().toISOString(),
      },
      client,
      leaseUntil,
    );
    return;
  }

  const provider = getById(handle.providerId);
  if (!provider || !provider.poll) {
    updateJobAndGeneration(
      job.id,
      job.generationId,
      {
        status: 'failed',
        error: JSON.stringify({
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider ${handle.providerId} not available`,
          retryable: false,
        }),
        pollLeaseUntil: null,
        updatedAt: new Date().toISOString(),
      },
      client,
      leaseUntil,
    );
    return;
  }

  let pollResult: PollResult;
  try {
    pollResult = await provider.poll(handle);
  } catch (err) {
    pollResult = {
      status: 'failed',
      error: {
        code: 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
    };
  }

  try {
    await applyPollResult(job, pollResult, client, leaseUntil);
  } catch (err) {
    updateJobAndGeneration(
      job.id,
      job.generationId,
      {
        status: 'failed',
        error: JSON.stringify({
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        }),
        pollLeaseUntil: null,
        updatedAt: new Date().toISOString(),
      },
      client,
      leaseUntil,
    );
  }
}

async function applyPollResult(
  job: GenerationJob,
  pollResult: PollResult,
  client: DbClient,
  expectedPollLeaseUntil: string,
): Promise<void> {
  const now = new Date().toISOString();

  switch (pollResult.status) {
    case 'pending':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        { status: 'pending', pollLeaseUntil: null, updatedAt: now },
        client,
        expectedPollLeaseUntil,
      );
      break;
    case 'running':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        { status: 'running', pollLeaseUntil: null, updatedAt: now },
        client,
        expectedPollLeaseUntil,
      );
      break;
    case 'completed':
      await completeSync(
        job.generationId,
        job.id,
        pollResult.images,
        client,
        expectedPollLeaseUntil,
      );
      return;
    case 'failed':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        {
          status: 'failed',
          error: JSON.stringify(pollResult.error),
          pollLeaseUntil: null,
          updatedAt: now,
        },
        client,
        expectedPollLeaseUntil,
      );
      break;
    case 'cancelled':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        { status: 'cancelled', pollLeaseUntil: null, updatedAt: now },
        client,
        expectedPollLeaseUntil,
      );
      break;
  }
}

export function updateJobAndGeneration(
  jobId: string,
  generationId: string,
  jobPatch: {
    status: GenerationStatus;
    error?: string | null;
    providerHandle?: string | null;
    pollLeaseUntil?: string | null;
    updatedAt: string;
  },
  client: DbClient,
  expectedPollLeaseUntil?: string,
): void {
  client.transaction((tx) => {
    const updated = expectedPollLeaseUntil
      ? updateGenerationJobIfLease(jobId, expectedPollLeaseUntil, jobPatch, tx)
      : (updateGenerationJob(jobId, jobPatch, tx), true);
    if (!updated) return;
    const status = deriveGenerationStatus(generationId, tx);
    updateGeneration(
      generationId,
      { status, updatedAt: jobPatch.updatedAt },
      tx,
    );
  });
}

export function syncGenerationStatus(
  generationId: string,
  client: DbClient,
): void {
  const status = deriveGenerationStatus(generationId, client);
  updateGeneration(
    generationId,
    { status, updatedAt: new Date().toISOString() },
    client,
  );
}

function deriveGenerationStatus(
  generationId: string,
  client: DbClient,
): GenerationStatus {
  const generation = getGenerationWithJobsAndImages(generationId, client);
  if (!generation) return 'failed';
  return aggregateGenerationStatus(generation.jobs);
}
