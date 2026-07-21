import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import {
  admitGenerationWithJobs,
  getGenerationByClientRequestId,
  getGenerationWithJobsAndImages,
  listFavoriteImageIds,
  requestGenerationCancellation,
  sessions,
  type DbClient,
  type GenerationWithJobsAndImages,
} from '../db';
import { IdempotencyKeyReusedError, NotFoundError, ValidationError } from '../errors';
import * as prompt from '../prompt';
import { getById } from '../providers';
import type { NormalizedRequest, ProviderCapabilities } from '../providers';
import { toSafeJobError } from './job-error';
import { advance, cleanupStagedResultSnapshot } from './lifecycle';
import { prepareGenerationIdempotency } from './idempotency';
import {
  createRequestSnapshot,
  REQUEST_SNAPSHOT_VERSION,
} from './request-snapshot';
import type {
  GenerationStatus,
  GenerationTarget,
  GenerationView,
  SubmitGenerationParams,
} from './types';
import { validate } from './validator';

export type SubmitResult = {
  generationId: string;
  status: GenerationStatus;
  replayed: boolean;
};

export type OrchestratorContext = {
  db: DbClient;
};

const DETAIL_ADVANCE_BATCH_SIZE = 16;

async function advanceJobsInBatches(
  jobs: GenerationWithJobsAndImages['jobs'],
  client: DbClient,
): Promise<void> {
  for (let offset = 0; offset < jobs.length; offset += DETAIL_ADVANCE_BATCH_SIZE) {
    await Promise.allSettled(
      jobs
        .slice(offset, offset + DETAIL_ADVANCE_BATCH_SIZE)
        .map((job) => advance(job, client)),
    );
  }
}

function buildNormalizedRequest(
  params: SubmitGenerationParams,
  processedPrompt: string,
  capabilities: ProviderCapabilities,
): NormalizedRequest {
  return {
    prompt: processedPrompt,
    mode: params.mode,
    width: params.width ?? undefined,
    height: params.height ?? undefined,
    aspectRatio: params.aspectRatio ?? undefined,
    count: params.count ?? undefined,
    negativePrompt: params.negativePrompt ?? undefined,
    seed: capabilities.supportsSeed ? params.seed ?? undefined : undefined,
    referenceImages: params.referenceImages ?? undefined,
    providerOptions: params.providerOptions ?? undefined,
  };
}

function buildDurableJobs(
  params: SubmitGenerationParams,
  processedPrompt: string,
  generationId: string,
  now: string,
) {
  return params.targets.map((target) => {
    const provider = getById(target.provider);
    const capabilities = provider?.capabilities.get(target.model);
    // validate() ran immediately before this construction. Treat a mutable
    // registry changing inside that tiny window as a validation failure rather
    // than writing a queued job that cannot reconstruct its request.
    if (!provider || !capabilities) {
      throw new ValidationError('Provider configuration changed during admission');
    }
    return {
      id: randomUUID(),
      generationId,
      provider: target.provider,
      model: target.model,
      status: 'pending' as const,
      phase: 'queued' as const,
      requestSnapshot: createRequestSnapshot(
        buildNormalizedRequest(params, processedPrompt, capabilities),
      ),
      requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
      attemptCount: 0,
      nextPollAt: now,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * Durable admission only. Provider submission is intentionally performed by
 * advance()/worker after this transaction has committed, so a lost HTTP
 * response cannot erase the only record of a billable user intent.
 */
export async function submitGeneration(
  params: SubmitGenerationParams,
  ctx: OrchestratorContext,
): Promise<SubmitResult> {
  const { clientRequestId, requestHash } = prepareGenerationIdempotency(params);
  const existing = getGenerationByClientRequestId(clientRequestId, ctx.db);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError(
        'clientRequestId was already used for a different generation payload',
      );
    }
    return {
      generationId: existing.id,
      status: existing.status as GenerationStatus,
      replayed: true,
    };
  }

  validate(params, { db: ctx.db });
  const now = new Date().toISOString();
  const generationId = randomUUID();
  const processedPrompt = prompt.process(params.prompt);
  const jobs = buildDurableJobs(params, processedPrompt, generationId, now);
  const admission = admitGenerationWithJobs(
    {
      id: generationId,
      sessionId: params.sessionId,
      prompt: processedPrompt,
      status: 'pending',
      clientRequestId,
      requestHash,
      createdAt: now,
      updatedAt: now,
    },
    jobs,
    ctx.db,
  );
  if (admission.kind === 'conflict') {
    throw new IdempotencyKeyReusedError(
      'clientRequestId was already used for a different generation payload',
    );
  }
  return {
    generationId: admission.generation.id,
    status: admission.generation.status as GenerationStatus,
    replayed: admission.kind === 'replayed',
  };
}

export async function getGeneration(
  id: string,
  ctx: OrchestratorContext,
): Promise<GenerationView> {
  let generation = getGenerationWithJobsAndImages(id, ctx.db);
  if (!generation) throw new NotFoundError(`Generation not found: ${id}`);

  // Detail is a recovery trigger when the optional worker is intentionally
  // disabled, but advance still honours persisted due times and leases.
  await advanceJobsInBatches(generation.jobs, ctx.db);
  generation = getGenerationWithJobsAndImages(id, ctx.db)!;
  return toGenerationView(generation, ctx.db);
}

/**
 * Makes cancellation visible locally in one short DB write. A worker performs
 * the best-effort remote cancellation later for jobs with a durable handle.
 */
export async function cancelGeneration(
  id: string,
  ctx: OrchestratorContext,
): Promise<GenerationView> {
  const requestedAt = new Date().toISOString();
  const { generation, cancelledSnapshots } = ctx.db.transaction((tx) => {
    const current = getGenerationWithJobsAndImages(id, tx);
    if (!current) throw new NotFoundError(`Generation not found: ${id}`);
    const cancelledSnapshots = current.jobs
      .filter((job) => (
        (job.status === 'pending' || job.status === 'running') &&
        job.cancelRequestedAt === null
      ))
      .map((job) => job.resultSnapshot);
    requestGenerationCancellation(id, requestedAt, tx);
    return {
      generation: getGenerationWithJobsAndImages(id, tx)!,
      cancelledSnapshots,
    };
  });
  for (const snapshot of cancelledSnapshots) cleanupStagedResultSnapshot(snapshot);
  return toGenerationView(generation, ctx.db);
}

function toGenerationView(
  generation: GenerationWithJobsAndImages,
  client: DbClient,
): GenerationView {
  const session = client
    .select({ projectId: sessions.projectId })
    .from(sessions)
    .where(eq(sessions.id, generation.sessionId))
    .get();
  if (!session) throw new NotFoundError(`Session not found: ${generation.sessionId}`);
  const favoriteImageIds = listFavoriteImageIds(
    generation.images.map((image) => image.id),
    client,
  );
  return {
    id: generation.id,
    sessionId: generation.sessionId,
    projectId: session.projectId,
    prompt: generation.prompt,
    status: generation.status as GenerationStatus,
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
    jobs: generation.jobs.map((job) => {
      const error = toSafeJobError(job.error);
      const waitingForProvider =
        (job.phase === 'queued' || job.phase === 'polling') &&
        (job.status === 'pending' || job.status === 'running') &&
        error?.code === 'RATE_LIMITED' &&
        error.retryable;
      return {
        id: job.id,
        provider: job.provider as GenerationView['jobs'][number]['provider'],
        model: job.model,
        status: job.status as GenerationStatus,
        error,
        ...(waitingForProvider
          ? {
              waitingForProvider: true,
              ...(job.nextPollAt ? { nextAttemptAt: job.nextPollAt } : {}),
            }
          : {}),
      };
    }),
    images: generation.images.map((image) => ({
      id: image.id,
      jobId: image.generationJobId,
      index: image.index,
      url: `/api/images/${image.id}`,
      width: image.width,
      height: image.height,
      favorited: favoriteImageIds.has(image.id),
    })),
  };
}
