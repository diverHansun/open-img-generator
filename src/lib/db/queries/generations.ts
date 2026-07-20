import { and, asc, eq, inArray, isNull, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db, type DbClient } from '../client';
import { generations, generationJobs, images, sessions } from '../schema';
import type { Generation, GenerationJob, Image } from '../schema';

export type GenerationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GenerationJobPhase =
  | 'queued'
  | 'dispatching'
  | 'polling'
  | 'storing'
  | 'cancelling'
  | 'terminal'
  | 'outcome_unknown';

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
  phase?: GenerationJobPhase;
  requestSnapshot?: string | null;
  requestSnapshotVersion?: number | null;
  resultSnapshot?: string | null;
  attemptCount?: number;
  retryStartedAt?: string | null;
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
  phase?: GenerationJobPhase;
  requestSnapshot?: string | null;
  requestSnapshotVersion?: number | null;
  resultSnapshot?: string | null;
  attemptCount?: number;
  retryStartedAt?: string | null;
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

export type IdempotentCreateGenerationParams = CreateGenerationParams & {
  clientRequestId: string;
  requestHash: string;
};

export type GenerationAdmissionResult = {
  kind: 'created' | 'replayed' | 'conflict';
  generation: Generation;
  jobs: GenerationJob[];
};

function defaultJobPhase(status: GenerationStatus): GenerationJobPhase {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
    ? 'terminal'
    : 'queued';
}

function jobInsertValues(job: CreateGenerationJobParams) {
  return {
    id: job.id,
    generationId: job.generationId,
    provider: job.provider,
    model: job.model,
    status: job.status,
    providerHandle: null,
    error: null,
    phase: job.phase ?? defaultJobPhase(job.status),
    requestSnapshot: job.requestSnapshot ?? null,
    requestSnapshotVersion: job.requestSnapshotVersion ?? null,
    resultSnapshot: job.resultSnapshot ?? null,
    attemptCount: job.attemptCount ?? 0,
    retryStartedAt: job.retryStartedAt ?? null,
    pollLeaseUntil: job.pollLeaseUntil ?? null,
    nextPollAt: job.nextPollAt ?? null,
    cancelRequestedAt: job.cancelRequestedAt ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function jobPatchValues(patch: UpdateGenerationJobPatch) {
  return {
    status: patch.status,
    providerHandle: patch.providerHandle,
    error: patch.error,
    phase: patch.phase,
    requestSnapshot: patch.requestSnapshot,
    requestSnapshotVersion: patch.requestSnapshotVersion,
    resultSnapshot: patch.resultSnapshot,
    attemptCount: patch.attemptCount,
    retryStartedAt: patch.retryStartedAt,
    pollLeaseUntil: patch.pollLeaseUntil,
    nextPollAt: patch.nextPollAt,
    cancelRequestedAt: patch.cancelRequestedAt,
    updatedAt: patch.updatedAt,
  };
}

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
        jobParams.map(jobInsertValues),
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

/**
 * Atomically admits a generation intent or returns the row already associated
 * with its client request id. Provider work must only start for `created`.
 *
 * `conflict` means the key exists with a different canonical request hash.
 * The IMMEDIATE transaction serializes admission across SQLite connections;
 * the partial unique index remains the final duplicate-prevention boundary.
 */
export function admitGenerationWithJobs(
  genParams: IdempotentCreateGenerationParams,
  jobParams: CreateGenerationJobParams[],
  client: DbClient = db,
): GenerationAdmissionResult {
  if (jobParams.length === 0) {
    throw new Error('A generation requires at least one job');
  }
  if (jobParams.some((job) => job.generationId !== genParams.id)) {
    throw new Error('Every job must belong to the admitted generation');
  }

  return client.transaction(
    (tx) => {
      const inserted = tx
        .insert(generations)
        .values({
          id: genParams.id,
          sessionId: genParams.sessionId,
          prompt: genParams.prompt,
          status: genParams.status,
          clientRequestId: genParams.clientRequestId,
          requestHash: genParams.requestHash,
          createdAt: genParams.createdAt,
          updatedAt: genParams.updatedAt,
        })
        .onConflictDoNothing()
        .run();

      if (inserted.changes === 0) {
        const existing = tx
          .select()
          .from(generations)
          .where(eq(generations.clientRequestId, genParams.clientRequestId))
          .get();
        if (!existing) {
          throw new Error('Generation admission conflict could not be resolved');
        }
        const existingJobs = tx
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.generationId, existing.id))
          .all();
        return {
          kind:
            existing.requestHash === genParams.requestHash
              ? 'replayed'
              : 'conflict',
          generation: existing,
          jobs: existingJobs,
        };
      }

      tx.insert(generationJobs)
        .values(
          jobParams.map(jobInsertValues),
        )
        .run();
      tx.update(sessions)
        .set({ updatedAt: genParams.updatedAt })
        .where(eq(sessions.id, genParams.sessionId))
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
      return { kind: 'created', generation, jobs };
    },
    { behavior: 'immediate' },
  );
}

export function createGenerationAndJob(
  genParams: CreateGenerationParams,
  jobParams: CreateGenerationJobParams,
  client: DbClient = db,
): { generation: Generation; job: GenerationJob } {
  const { generation, jobs } = createGenerationWithJobs(genParams, [jobParams], client);
  return { generation, job: jobs[0]! };
}

export function getGenerationByClientRequestId(
  clientRequestId: string,
  client: DbClient = db,
): Generation | undefined {
  return client
    .select()
    .from(generations)
    .where(eq(generations.clientRequestId, clientRequestId))
    .get();
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
    .set(jobPatchValues(patch))
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
    .set(jobPatchValues(patch))
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
  options: {
    expectedPhase?: GenerationJobPhase;
    allowCancellation?: boolean;
  } = {},
): boolean {
  const result = client
    .update(generationJobs)
    .set(jobPatchValues(patch))
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.pollLeaseUntil, expectedPollLeaseUntil),
        ...(options.expectedPhase
          ? [eq(generationJobs.phase, options.expectedPhase)]
          : []),
        ...(options.allowCancellation
          ? []
          : [isNull(generationJobs.cancelRequestedAt)]),
      ),
    )
    .run();
  return result.changes > 0;
}

function isDueAndUnleased(now: string, force: boolean) {
  return [
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
  ];
}

/** Claims a queued job and records the dangerous dispatching checkpoint first. */
export function tryClaimQueuedJobForDispatch(
  id: string,
  now: string,
  leaseUntil: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({
      phase: 'dispatching',
      pollLeaseUntil: leaseUntil,
      nextPollAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.phase, 'queued'),
        eq(generationJobs.status, 'pending'),
        isNull(generationJobs.cancelRequestedAt),
        ...isDueAndUnleased(now, false),
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
    .set({
      phase: 'polling',
      pollLeaseUntil: leaseUntil,
      nextPollAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        inArray(generationJobs.status, ['pending', 'running']),
        isNull(generationJobs.cancelRequestedAt),
        isNotNull(generationJobs.providerHandle),
        // Queued+handle is accepted only as a compatibility bridge for rows
        // created before the phase checkpoint was introduced.
        inArray(generationJobs.phase, ['queued', 'polling']),
        ...isDueAndUnleased(now, force),
      ),
    )
    .run();
  return result.changes > 0;
}

export function tryClaimStoringLease(
  id: string,
  now: string,
  leaseUntil: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({ pollLeaseUntil: leaseUntil, nextPollAt: null, updatedAt: now })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.phase, 'storing'),
        eq(generationJobs.status, 'running'),
        isNull(generationJobs.cancelRequestedAt),
        ...isDueAndUnleased(now, false),
      ),
    )
    .run();
  return result.changes > 0;
}

export function tryClaimCancellingLease(
  id: string,
  now: string,
  leaseUntil: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({ pollLeaseUntil: leaseUntil, nextPollAt: null, updatedAt: now })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.phase, 'cancelling'),
        eq(generationJobs.status, 'cancelled'),
        isNotNull(generationJobs.cancelRequestedAt),
        ...isDueAndUnleased(now, false),
      ),
    )
    .run();
  return result.changes > 0;
}

/**
 * A lease expired while an external submit might have been in flight. Since no
 * handle/result was durably recorded, replaying can create a second billable
 * provider job; preserve the uncertainty instead.
 */
export function markExpiredDispatchingJobOutcomeUnknown(
  id: string,
  now: string,
  error: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({
      status: 'failed',
      phase: 'outcome_unknown',
      error,
      pollLeaseUntil: null,
      nextPollAt: null,
      requestSnapshot: null,
      requestSnapshotVersion: null,
      resultSnapshot: null,
      attemptCount: 0,
      retryStartedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.phase, 'dispatching'),
        inArray(generationJobs.status, ['pending', 'running']),
        isNull(generationJobs.cancelRequestedAt),
        or(
          isNull(generationJobs.pollLeaseUntil),
          lte(generationJobs.pollLeaseUntil, now),
        ),
      ),
    )
    .run();
  return result.changes > 0;
}

function cancellationPatch(requestedAt: string) {
  // A queued row has not crossed the durable dispatch checkpoint and can end
  // immediately. A dispatching row may already have an HTTP submit in flight,
  // even though its handle has not returned yet: retain that dispatch lease so
  // a late async handle can be persisted and cancelled instead of being lost.
  const hasNoHandle = sql`${generationJobs.providerHandle} IS NULL`;
  const untouchedQueued = sql`${generationJobs.phase} = 'queued' AND ${hasNoHandle}`;
  const inFlightPhase = sql`${generationJobs.phase} IN ('dispatching', 'storing') AND ${generationJobs.pollLeaseUntil} IS NOT NULL`;
  return {
    status: 'cancelled' as const,
    cancelRequestedAt: requestedAt,
    // A previous poll retry is not a cancellation failure. Clear the stale
    // diagnostic immediately so the local cancelled response is truthful.
    error: null,
    phase: sql`CASE
      WHEN ${untouchedQueued} THEN 'terminal'
      ELSE 'cancelling'
    END`,
    pollLeaseUntil: sql`CASE
      WHEN ${inFlightPhase} THEN ${generationJobs.pollLeaseUntil}
      ELSE NULL
    END`,
    nextPollAt: sql`CASE
      WHEN ${untouchedQueued} THEN NULL
      WHEN ${inFlightPhase} THEN ${generationJobs.nextPollAt}
      ELSE ${requestedAt}
    END`,
    // No cancellation recovery path needs the request or result payload. In
    // particular, do not retain reference URLs while waiting for a late handle.
    requestSnapshot: null,
    requestSnapshotVersion: null,
    resultSnapshot: null,
    attemptCount: 0,
    retryStartedAt: null,
    updatedAt: requestedAt,
  };
}

export function requestGenerationJobCancellation(
  id: string,
  requestedAt: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set(cancellationPatch(requestedAt))
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

/**
 * Cancels every active job and re-aggregates the Generation in the caller's
 * transaction. Keeping this as one SQL update prevents a fan-out cancellation
 * from becoming a partially applied sequence when a process or DB fails.
 */
export function requestGenerationCancellation(
  generationId: string,
  requestedAt: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set(cancellationPatch(requestedAt))
    .where(
      and(
        eq(generationJobs.generationId, generationId),
        inArray(generationJobs.status, ['pending', 'running']),
        isNull(generationJobs.cancelRequestedAt),
      ),
    )
    .run();
  if (result.changes === 0) return false;

  const jobs = client
    .select({ status: generationJobs.status })
    .from(generationJobs)
    .where(eq(generationJobs.generationId, generationId))
    .all();
  client
    .update(generations)
    .set({ status: aggregateGenerationStatus(jobs), updatedAt: requestedAt })
    .where(eq(generations.id, generationId))
    .run();
  return true;
}

/**
 * A provider may return an async handle after local cancellation won the
 * dispatch race. Persist it under the cancellation marker so the worker can
 * still make the remote cancellation attempt; do not resurrect public status.
 */
export function persistLateProviderHandleForCancellation(
  id: string,
  providerHandle: string,
  expectedDispatchLeaseUntil: string,
  now: string,
  client: DbClient = db,
): boolean {
  const result = client
    .update(generationJobs)
    .set({
      providerHandle,
      phase: 'cancelling',
      pollLeaseUntil: null,
      nextPollAt: now,
      requestSnapshot: null,
      requestSnapshotVersion: null,
      resultSnapshot: null,
      attemptCount: 0,
      retryStartedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.status, 'cancelled'),
        eq(generationJobs.phase, 'cancelling'),
        isNotNull(generationJobs.cancelRequestedAt),
        isNull(generationJobs.providerHandle),
        eq(generationJobs.pollLeaseUntil, expectedDispatchLeaseUntil),
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
        inArray(generationJobs.phase, [
          'queued',
          'dispatching',
          'polling',
          'storing',
          'cancelling',
        ]),
        or(
          inArray(generationJobs.status, ['pending', 'running']),
          and(
            eq(generationJobs.status, 'cancelled'),
            eq(generationJobs.phase, 'cancelling'),
          ),
        ),
        or(isNull(generationJobs.nextPollAt), lte(generationJobs.nextPollAt, now)),
        or(
          isNull(generationJobs.pollLeaseUntil),
          lte(generationJobs.pollLeaseUntil, now),
        ),
      ),
    )
    .orderBy(
      asc(generationJobs.nextPollAt),
      asc(generationJobs.updatedAt),
      asc(generationJobs.id),
    )
    .limit(limit)
    .all();
}

/** Opaque result snapshots may keep a staged inline image recoverable. */
export function listGenerationJobResultSnapshots(
  client: DbClient = db,
): string[] {
  return client
    .select({ resultSnapshot: generationJobs.resultSnapshot })
    .from(generationJobs)
    .where(isNotNull(generationJobs.resultSnapshot))
    .all()
    .map((row) => row.resultSnapshot!);
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
