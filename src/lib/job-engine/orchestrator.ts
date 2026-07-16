import { randomUUID } from 'node:crypto';
import { validate } from './validator';
import * as prompt from '../prompt';
import {
  createGenerationWithJobs,
  getGenerationWithJobsAndImages,
  touchSession,
  type DbClient,
} from '../db';
import { getById } from '../providers';
import type { NormalizedRequest, ProviderCapabilities, ImageProvider } from '../providers';
import { completeSync, advance, updateJobAndGeneration } from './lifecycle';
import { NotFoundError } from '../errors';
import type { GenerationWithJobsAndImages } from '../db';
import type {
  SubmitGenerationParams,
  GenerationTarget,
  GenerationView,
  GenerationStatus,
  JobView,
} from './types';

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
    width: params.width,
    height: params.height,
    aspectRatio: params.aspectRatio,
    count: params.count,
    negativePrompt: params.negativePrompt,
    seed: capabilities.supportsSeed ? params.seed : undefined,
    providerOptions: params.providerOptions,
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
    updateJobAndGeneration(
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
    submitResult = await provider.submit(normalized, target.model);
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

  switch (submitResult.kind) {
    case 'sync':
      await completeSync(job.generationId, job.id, submitResult.images, client);
      return;
    case 'async':
      updateJobAndGeneration(
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
      updateJobAndGeneration(
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
        .map((job) => advance(job, ctx.db)),
    );
    generation = getGenerationWithJobsAndImages(id, ctx.db)!;
  }

  return toGenerationView(generation);
}

function parseJobError(error: string | null): JobView['error'] {
  if (!error) return undefined;
  try {
    return JSON.parse(error) as NonNullable<JobView['error']>;
  } catch {
    return { code: 'UNKNOWN', message: error, retryable: false };
  }
}

function toGenerationView(generation: GenerationWithJobsAndImages): GenerationView {
  return {
    id: generation.id,
    sessionId: generation.sessionId,
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
    })),
  };
}
