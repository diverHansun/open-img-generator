import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { validate, type ValidationContext } from './validator';
import * as prompt from '../prompt';
import {
  createGenerationAndJob,
  getGenerationWithJobsAndImages,
  touchSession,
  generationJobs,
  type DbClient,
} from '../db';
import { getById } from '../providers';
import type { NormalizedRequest } from '../providers';
import { completeSync, advance, syncGenerationStatus } from './lifecycle';
import { NotFoundError } from '../errors';
import type { GenerationWithJobsAndImages } from '../db';
import type {
  SubmitGenerationParams,
  GenerationView,
  GenerationStatus,
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
): NormalizedRequest {
  return {
    prompt: processedPrompt,
    mode: params.mode,
    width: params.width,
    height: params.height,
    aspectRatio: params.aspectRatio,
    count: params.count,
    negativePrompt: params.negativePrompt,
    seed: params.seed,
    providerOptions: params.providerOptions,
  };
}

export async function submitGeneration(
  params: SubmitGenerationParams,
  ctx: OrchestratorContext,
): Promise<SubmitResult> {
  validate(params, { db: ctx.db });

  const processedPrompt = prompt.process(params.prompt);
  const now = new Date().toISOString();
  const generationId = randomUUID();
  const jobId = randomUUID();

  createGenerationAndJob(
    {
      id: generationId,
      sessionId: params.sessionId,
      prompt: processedPrompt,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: jobId,
      generationId,
      provider: params.provider,
      model: params.model,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    ctx.db,
  );

  if (params.sessionId) {
    touchSession(params.sessionId, now, ctx.db);
  }

  const provider = getById(params.provider);
  if (!provider) {
    throw new Error(`Provider ${params.provider} disappeared after validation`);
  }

  const normalized = buildNormalizedRequest(params, processedPrompt);
  const submitResult = await provider.submit(normalized, params.model);

  switch (submitResult.kind) {
    case 'sync':
      await completeSync(generationId, jobId, submitResult.images, ctx.db);
      break;
    case 'async':
      ctx.db
        .update(generationJobs)
        .set({
          status: 'pending',
          providerHandle: JSON.stringify(submitResult.handle),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(generationJobs.id, jobId))
        .run();
      break;
    case 'failed':
      ctx.db
        .update(generationJobs)
        .set({
          status: 'failed',
          error: JSON.stringify(submitResult.error),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(generationJobs.id, jobId))
        .run();
      syncGenerationStatus(generationId, ctx.db);
      break;
  }

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
    for (const job of generation.jobs) {
      if (job.status === 'pending' || job.status === 'running') {
        await advance(job, ctx.db);
      }
    }
    generation = getGenerationWithJobsAndImages(id, ctx.db)!;
  }

  return toGenerationView(generation);
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
      error: job.error
        ? (JSON.parse(job.error) as {
            code: string;
            message: string;
            retryable: boolean;
          })
        : undefined,
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
