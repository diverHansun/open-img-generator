import { eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  updateGenerationJob,
  updateGeneration,
  createImage,
  imageExists,
  getGenerationWithJobsAndImages,
  aggregateGenerationStatus,
  type DbClient,
  type GenerationJob,
  generationJobs,
} from '../db';
import { getById } from '../providers';
import type { JobHandle, PollResult, ProviderImageRef } from '../providers';
import * as storage from '../storage';
import { StorageError } from '../errors';
import type { GenerationStatus } from './types';

export type StoreImagesResult =
  | { kind: 'ok'; count: number }
  | { kind: 'failed'; error: StorageError };

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

    createImage(
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
    storedIndexes.push(ref.index);
  }

  return { kind: 'ok', count: storedIndexes.length };
}

export async function completeSync(
  generationId: string,
  jobId: string,
  images: ProviderImageRef[],
  client: DbClient,
): Promise<void> {
  const storeResult = await storeImages(jobId, images, client);
  const now = new Date().toISOString();

  client.transaction((tx) => {
    if (storeResult.kind === 'ok') {
      updateGenerationJob(jobId, { status: 'completed', updatedAt: now }, tx);
    } else {
      updateGenerationJob(
        jobId,
        {
          status: 'failed',
          error: JSON.stringify({
            code: 'STORAGE_ERROR',
            message: storeResult.error.message,
            retryable: false,
          }),
          updatedAt: now,
        },
        tx,
      );
    }

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
  const now = new Date().toISOString();

  const lockResult = client
    .update(generationJobs)
    .set({ status: 'running', updatedAt: now })
    .where(
      and(
        eq(generationJobs.id, job.id),
        inArray(generationJobs.status, ['pending', 'running']),
      ),
    )
    .run();

  if (lockResult.changes === 0) {
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
        updatedAt: new Date().toISOString(),
      },
      client,
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
        updatedAt: new Date().toISOString(),
      },
      client,
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

  await applyPollResult(job, pollResult, client);
}

async function applyPollResult(
  job: GenerationJob,
  pollResult: PollResult,
  client: DbClient,
): Promise<void> {
  const now = new Date().toISOString();

  switch (pollResult.status) {
    case 'pending':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        { status: 'pending', updatedAt: now },
        client,
      );
      break;
    case 'running':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        { status: 'running', updatedAt: now },
        client,
      );
      break;
    case 'completed':
      await completeSync(job.generationId, job.id, pollResult.images, client);
      return;
    case 'failed':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        {
          status: 'failed',
          error: JSON.stringify(pollResult.error),
          updatedAt: now,
        },
        client,
      );
      break;
    case 'cancelled':
      updateJobAndGeneration(
        job.id,
        job.generationId,
        { status: 'cancelled', updatedAt: now },
        client,
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
    updatedAt: string;
  },
  client: DbClient,
): void {
  client.transaction((tx) => {
    updateGenerationJob(jobId, jobPatch, tx);
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
