import { and, eq, inArray, isNull, isNotNull, lte, or } from 'drizzle-orm';
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
  sessionId: string;
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
  pollLeaseUntil?: string | null;
  nextPollAt?: string | null;
  cancelRequestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateGenerationJobPatch = {
  status?: GenerationStatus;
  providerHandle?: string | null;
  error?: string | null;
  pollLeaseUntil?: string | null;
  nextPollAt?: string | null;
  cancelRequestedAt?: string | null;
  updatedAt: string;
};

export type JobWithImages = GenerationJob & { images: Image[] };
export type GenerationWithJobsAndImages = Generation & {
  jobs: JobWithImages[];
  images: Image[];
};

export function createGenerationWithJobs(
  genParams: CreateGenerationParams,
  jobParams: CreateGenerationJobParams[],
  client: DbClient = db,
): { generation: Generation; jobs: GenerationJob[] } {
  if (jobParams.length === 0) {
    throw new Error('A generation requires at least one job');
  }

  return client.transaction((tx) => {
    tx.insert(generations)
      .values({
        id: genParams.id,
        sessionId: genParams.sessionId,
        prompt: genParams.prompt,
        status: genParams.status,
        createdAt: genParams.createdAt,
        updatedAt: genParams.updatedAt,
      })
      .run();

    tx.insert(generationJobs)
      .values(
        jobParams.map((job) => ({
          id: job.id,
          generationId: job.generationId,
          provider: job.provider,
          model: job.model,
          status: job.status,
          providerHandle: null,
          error: null,
          pollLeaseUntil: job.pollLeaseUntil ?? null,
          nextPollAt: job.nextPollAt ?? null,
          cancelRequestedAt: job.cancelRequestedAt ?? null,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })),
      )
      .run();

    const generation = tx
      .select()
      .from(generations)
      .where(eq(generations.id, genParams.id))
      .get()!;
    const jobs = tx
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.generationId, genParams.id))
      .all();
    return { generation, jobs };
  });
}

export function createGenerationAndJob(
  genParams: CreateGenerationParams,
  jobParams: CreateGenerationJobParams,
  client: DbClient = db,
): { generation: Generation; job: GenerationJob } {
  const { generation, jobs } = createGenerationWithJobs(genParams, [jobParams], client);
  return { generation, job: jobs[0]! };
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
      pollLeaseUntil: patch.pollLeaseUntil,
      nextPollAt: patch.nextPollAt,
      cancelRequestedAt: patch.cancelRequestedAt,
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

/**
 * Updates a job unless a cancellation request has already won the race.
 * Sync providers do not hold a poll lease, so their completion path uses
 * this marker-guarded write instead of the lease CAS helper.
 */
export function updateGenerationJobIfNotCancelled(
  id: string,
  patch: UpdateGenerationJobPatch,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({
      status: patch.status,
      providerHandle: patch.providerHandle,
      error: patch.error,
      pollLeaseUntil: patch.pollLeaseUntil,
      nextPollAt: patch.nextPollAt,
      cancelRequestedAt: patch.cancelRequestedAt,
      updatedAt: patch.updatedAt,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        isNull(generationJobs.cancelRequestedAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function getGenerationJob(
  id: string,
  client: DbClient = db,
): GenerationJob | undefined {
  return client
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .get();
}

/**
 * Updates a job only while the caller still owns its poll lease.
 *
 * The lease expiry is also the lease token: every successful claim writes a
 * fresh ISO timestamp, so an old poll response cannot overwrite a newer
 * worker's result after the lease has expired.
 */
export function updateGenerationJobIfLease(
  id: string,
  expectedPollLeaseUntil: string,
  patch: UpdateGenerationJobPatch,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({
      status: patch.status,
      providerHandle: patch.providerHandle,
      error: patch.error,
      pollLeaseUntil: patch.pollLeaseUntil,
      nextPollAt: patch.nextPollAt,
      cancelRequestedAt: patch.cancelRequestedAt,
      updatedAt: patch.updatedAt,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.pollLeaseUntil, expectedPollLeaseUntil),
        isNull(generationJobs.cancelRequestedAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function tryClaimPollLease(
  id: string,
  now: string,
  leaseUntil: string,
  client: DbClient = db,
  force = false,
): boolean {
  const result = client
    .update(generationJobs)
    .set({ pollLeaseUntil: leaseUntil, nextPollAt: null, updatedAt: now })
    .where(
      and(
        eq(generationJobs.id, id),
        inArray(generationJobs.status, ['pending', 'running']),
        isNull(generationJobs.cancelRequestedAt),
        ...(force
          ? []
          : [
              or(
                isNull(generationJobs.nextPollAt),
                lte(generationJobs.nextPollAt, now),
              ),
            ]),
        or(
          isNull(generationJobs.pollLeaseUntil),
          lte(generationJobs.pollLeaseUntil, now),
        ),
      ),
    )
    .run();
  return result.changes > 0;
}

export function requestGenerationJobCancellation(
  id: string,
  requestedAt: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({ cancelRequestedAt: requestedAt, updatedAt: requestedAt })
    .where(
      and(
        eq(generationJobs.id, id),
        inArray(generationJobs.status, ['pending', 'running']),
        isNull(generationJobs.cancelRequestedAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function listDueGenerationJobs(
  now: string,
  limit = 16,
  client: DbClient = db,
): GenerationJob[] {
  return client
    .select()
    .from(generationJobs)
    .where(
      and(
        inArray(generationJobs.status, ['pending', 'running']),
        isNotNull(generationJobs.providerHandle),
        isNull(generationJobs.cancelRequestedAt),
        or(isNull(generationJobs.nextPollAt), lte(generationJobs.nextPollAt, now)),
      ),
    )
    .limit(limit)
    .all();
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
  if (statuses.some((s) => s === 'running')) return 'running';
  if (statuses.some((s) => s === 'pending')) return 'pending';
  if (statuses.some((s) => s === 'completed')) return 'completed';
  if (statuses.some((s) => s === 'cancelled')) return 'cancelled';
  return 'failed';
}
