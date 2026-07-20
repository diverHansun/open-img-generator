import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { validate } from './validator';
import * as prompt from '../prompt';
import {
  createGenerationWithJobs,
  getGenerationWithJobsAndImages,
  getGenerationJob,
  listFavoriteImageIds,
  sessions,
  touchSession,
  requestGenerationJobCancellation,
  type DbClient,
} from '../db';
import { getById } from '../providers';
import type { NormalizedRequest, ProviderCapabilities, ImageProvider } from '../providers';
import {
  completeSync,
  advance,
  updateJobAndGeneration,
  updateJobAndGenerationIfNotCancelled,
  syncGenerationStatus,
} from './lifecycle';
import { NotFoundError } from '../errors';
import type { GenerationWithJobsAndImages } from '../db';
import type {
  SubmitGenerationParams,
  GenerationTarget,
  GenerationView,
  GenerationStatus,
  JobView,
} from './types';
import { acquireGenerationSlot } from './admission';
import { withProviderLimit } from '../providers/limiter';

export type SubmitResult = {
  generationId: string;
  status: GenerationStatus;
};

export type OrchestratorContext = {
  db: DbClient;
};

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

async function submitTarget(
  job: { id: string; generationId: string },
  target: GenerationTarget,
  params: SubmitGenerationParams,
  processedPrompt: string,
  client: DbClient,
): Promise<void> {
  const provider = getById(target.provider);
  const capabilities = provider?.capabilities.get(target.model);
  if (!provider || !capabilities) {
    const currentJob = getGenerationJob(job.id, client);
    if (currentJob?.status === 'cancelled' || currentJob?.cancelRequestedAt) {
      updateJobAndGeneration(
        job.id,
        job.generationId,
        {
          status: 'cancelled',
          cancelRequestedAt: currentJob.cancelRequestedAt,
          error: JSON.stringify({
            code: 'CANCEL_UNSUPPORTED',
            message: 'Generation was cancelled before provider submission',
            retryable: false,
          }),
          updatedAt: new Date().toISOString(),
        },
        client,
      );
      return;
    }
    updateJobAndGenerationIfNotCancelled(
      job.id,
      job.generationId,
      {
        status: 'failed',
        error: JSON.stringify({
          code: 'PROVIDER_ERROR',
          message: `Provider ${target.provider} is no longer available`,
          retryable: false,
        }),
        updatedAt: new Date().toISOString(),
      },
      client,
    );
    return;
  }

  const normalized = buildNormalizedRequest(params, processedPrompt, capabilities);
  let submitResult: Awaited<ReturnType<ImageProvider['submit']>>;
  try {
    submitResult = await withProviderLimit(
      provider.id,
      () => provider.submit(normalized, target.model),
    );
  } catch (err) {
    submitResult = {
      kind: 'failed',
      error: {
        code: 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
    };
  }

  // Cancellation may win the race while the provider request is in flight.
  // Never let a late submit response resurrect a locally-cancelled job.
  const currentJob = getGenerationJob(job.id, client);
  if (currentJob?.status === 'cancelled' || currentJob?.cancelRequestedAt) {
    if (submitResult.kind === 'async' && provider.cancel) {
      try {
        await withProviderLimit(provider.id, () => provider.cancel!(submitResult.handle));
      } catch {
        // The local cancellation marker remains authoritative.
      }
    }
    if (currentJob.status !== 'cancelled') {
      updateJobAndGeneration(
        job.id,
        job.generationId,
        {
          status: 'cancelled',
          cancelRequestedAt: currentJob.cancelRequestedAt,
          pollLeaseUntil: null,
          nextPollAt: null,
          error: JSON.stringify({
            code: 'CANCEL_UNSUPPORTED',
            message: 'Generation was cancelled before provider submission completed',
            retryable: false,
          }),
          updatedAt: new Date().toISOString(),
        },
        client,
      );
    }
    return;
  }

  switch (submitResult.kind) {
    case 'sync':
      await completeSync(job.generationId, job.id, submitResult.images, client);
      return;
    case 'async':
      updateJobAndGenerationIfNotCancelled(
        job.id,
        job.generationId,
        {
          status: 'pending',
          providerHandle: JSON.stringify(submitResult.handle),
          updatedAt: new Date().toISOString(),
        },
        client,
      );
      return;
    case 'failed':
      updateJobAndGenerationIfNotCancelled(
        job.id,
        job.generationId,
        {
          status: 'failed',
          error: JSON.stringify(submitResult.error),
          updatedAt: new Date().toISOString(),
        },
        client,
      );
  }
}

async function submitTargetSafely(
  job: { id: string; generationId: string },
  target: GenerationTarget,
  params: SubmitGenerationParams,
  processedPrompt: string,
  client: DbClient,
): Promise<void> {
  try {
    await submitTarget(job, target, params, processedPrompt, client);
  } catch (err) {
    const currentJob = getGenerationJob(job.id, client);
    if (currentJob?.status === 'cancelled' || currentJob?.cancelRequestedAt) return;
    updateJobAndGenerationIfNotCancelled(
      job.id,
      job.generationId,
      {
        status: 'failed',
        error: JSON.stringify({
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        }),
        updatedAt: new Date().toISOString(),
      },
      client,
    );
  }
}

export async function submitGeneration(
  params: SubmitGenerationParams,
  ctx: OrchestratorContext,
): Promise<SubmitResult> {
  validate(params, { db: ctx.db });
  const releaseAdmission = acquireGenerationSlot();
  try {
    const processedPrompt = prompt.process(params.prompt);
    const now = new Date().toISOString();
    const generationId = randomUUID();
    const jobs = params.targets.map((target) => ({
      id: randomUUID(),
      generationId,
      provider: target.provider,
      model: target.model,
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
    }));

    createGenerationWithJobs(
      {
        id: generationId,
        sessionId: params.sessionId,
        prompt: processedPrompt,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      jobs,
      ctx.db,
    );

    touchSession(params.sessionId, now, ctx.db);

    await Promise.allSettled(
      jobs.map((job, index) =>
        submitTargetSafely(
          job,
          params.targets[index]!,
          params,
          processedPrompt,
          ctx.db,
        ),
      ),
    );

    const finalGeneration = getGenerationWithJobsAndImages(generationId, ctx.db);
    if (!finalGeneration) {
      throw new Error(`Generation ${generationId} not found after submit`);
    }

    return {
      generationId,
      status: finalGeneration.status as GenerationStatus,
    };
  } finally {
    releaseAdmission();
  }
}

export async function getGeneration(
  id: string,
  ctx: OrchestratorContext,
): Promise<GenerationView> {
  let generation = getGenerationWithJobsAndImages(id, ctx.db);
  if (!generation) {
    throw new NotFoundError(`Generation not found: ${id}`);
  }

  if (generation.status === 'pending' || generation.status === 'running') {
    await Promise.allSettled(
      generation.jobs
        .filter((job) => job.status === 'pending' || job.status === 'running')
        .map((job) => advance(job, ctx.db, { force: true })),
    );
    generation = getGenerationWithJobsAndImages(id, ctx.db)!;
  }

  return toGenerationView(generation, ctx.db);
}

export async function cancelGeneration(
  id: string,
  ctx: OrchestratorContext,
): Promise<GenerationView> {
  let generation = getGenerationWithJobsAndImages(id, ctx.db);
  if (!generation) throw new NotFoundError(`Generation not found: ${id}`);

  const requestedAt = new Date().toISOString();
  await Promise.all(
    generation.jobs
      .filter((job) => job.status === 'pending' || job.status === 'running')
      .map(async (job) => {
        if (!requestGenerationJobCancellation(job.id, requestedAt, ctx.db)) return;

        const provider = getById(job.provider as GenerationTarget['provider']);
        let cancellation: Awaited<ReturnType<NonNullable<ImageProvider['cancel']>>> | null = null;
        if (provider?.cancel && job.providerHandle) {
          try {
            const handle = JSON.parse(job.providerHandle) as import('../providers').JobHandle;
            cancellation = await withProviderLimit(
              provider.id,
              () => provider.cancel!(handle),
            );
          } catch (err) {
            cancellation = {
              status: 'failed',
              error: {
                code: 'PROVIDER_ERROR',
                message: err instanceof Error ? err.message : String(err),
                retryable: false,
              },
            };
          }
        }

        const warning = cancellation?.status === 'failed'
          ? cancellation.error
          : !provider?.cancel
            ? {
                code: 'CANCEL_UNSUPPORTED',
                message: 'Provider has no remote cancel endpoint; local polling stopped',
                retryable: false,
              }
            : null;
        updateJobAndGeneration(
          job.id,
          job.generationId,
          {
            status: 'cancelled',
            error: warning ? JSON.stringify(warning) : null,
            pollLeaseUntil: null,
            nextPollAt: null,
            cancelRequestedAt: requestedAt,
            updatedAt: new Date().toISOString(),
          },
          ctx.db,
        );
      }),
  );

  syncGenerationStatus(id, ctx.db);
  generation = getGenerationWithJobsAndImages(id, ctx.db)!;
  return toGenerationView(generation, ctx.db);
}

function parseJobError(error: string | null): JobView['error'] {
  if (!error) return undefined;
  try {
    return JSON.parse(error) as NonNullable<JobView['error']>;
  } catch {
    return { code: 'UNKNOWN', message: error, retryable: false };
  }
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
    jobs: generation.jobs.map((job) => ({
      id: job.id,
      provider: job.provider as GenerationView['jobs'][number]['provider'],
      model: job.model,
      status: job.status as GenerationStatus,
      error: parseJobError(job.error),
    })),
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
