import { eq, inArray } from 'drizzle-orm';
import { db, type DbClient } from '../client';
import { generations, generationJobs, images } from '../schema';
import type { Generation, GenerationJob, Image } from '../schema';

export type GenerationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CreateGenerationParams = {
  id: string;
  sessionId?: string | null;
  prompt: string;
  status: GenerationStatus;
  createdAt: string;
  updatedAt: string;
};

export type UpdateGenerationPatch = {
  status?: GenerationStatus;
  updatedAt: string;
};

export type CreateGenerationJobParams = {
  id: string;
  generationId: string;
  provider: string;
  model: string;
  status: GenerationStatus;
  createdAt: string;
  updatedAt: string;
};

export type UpdateGenerationJobPatch = {
  status?: GenerationStatus;
  providerHandle?: string | null;
  error?: string | null;
  updatedAt: string;
};

export type JobWithImages = GenerationJob & { images: Image[] };
export type GenerationWithJobsAndImages = Generation & {
  jobs: JobWithImages[];
  images: Image[];
};

export function createGenerationAndJob(
  genParams: CreateGenerationParams,
  jobParams: CreateGenerationJobParams,
  client: DbClient = db,
): { generation: Generation; job: GenerationJob } {
  return client.transaction((tx) => {
    tx.insert(generations)
      .values({
        id: genParams.id,
        sessionId: genParams.sessionId ?? null,
        prompt: genParams.prompt,
        status: genParams.status,
        createdAt: genParams.createdAt,
        updatedAt: genParams.updatedAt,
      })
      .run();

    tx.insert(generationJobs)
      .values({
        id: jobParams.id,
        generationId: jobParams.generationId,
        provider: jobParams.provider,
        model: jobParams.model,
        status: jobParams.status,
        providerHandle: null,
        error: null,
        createdAt: jobParams.createdAt,
        updatedAt: jobParams.updatedAt,
      })
      .run();

    const generation = tx
      .select()
      .from(generations)
      .where(eq(generations.id, genParams.id))
      .get()!;
    const job = tx
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, jobParams.id))
      .get()!;
    return { generation, job };
  });
}

export function updateGeneration(
  id: string,
  patch: UpdateGenerationPatch,
  client: DbClient = db,
): Generation {
  client
    .update(generations)
    .set({
      status: patch.status,
      updatedAt: patch.updatedAt,
    })
    .where(eq(generations.id, id))
    .run();
  return client
    .select()
    .from(generations)
    .where(eq(generations.id, id))
    .get()!;
}

export function updateGenerationJob(
  id: string,
  patch: UpdateGenerationJobPatch,
  client: DbClient = db,
): GenerationJob {
  client
    .update(generationJobs)
    .set({
      status: patch.status,
      providerHandle: patch.providerHandle,
      error: patch.error,
      updatedAt: patch.updatedAt,
    })
    .where(eq(generationJobs.id, id))
    .run();
  return client
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .get()!;
}

export function getGenerationWithJobsAndImages(
  id: string,
  client: DbClient = db,
): GenerationWithJobsAndImages | undefined {
  const generation = client
    .select()
    .from(generations)
    .where(eq(generations.id, id))
    .get();
  if (!generation) return undefined;
  return fetchGenerationDetails(generation, client);
}

export function fetchGenerationDetails(
  generation: Generation,
  client: DbClient = db,
): GenerationWithJobsAndImages {
  const jobs = client
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.generationId, generation.id))
    .all();

  const jobIds = jobs.map((j) => j.id);
  const allImages =
    jobIds.length > 0
      ? client
          .select()
          .from(images)
          .where(inArray(images.generationJobId, jobIds))
          .all()
      : [];

  const jobsWithImages = jobs.map((job) => ({
    ...job,
    images: allImages.filter((img) => img.generationJobId === job.id),
  }));

  return {
    ...generation,
    jobs: jobsWithImages,
    images: allImages,
  };
}

export function aggregateGenerationStatus(
  jobs: Pick<GenerationJob, 'status'>[],
): GenerationStatus {
  const statuses = jobs.map((j) => j.status);
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'cancelled')) return 'cancelled';
  if (statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.some((s) => s === 'running')) return 'running';
  return 'pending';
}
