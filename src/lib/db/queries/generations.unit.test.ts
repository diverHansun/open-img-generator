import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/db';
import { generations, generationJobs } from '../schema';
import {
  createGenerationAndJob,
  createGenerationWithJobs,
  admitGenerationWithJobs,
  updateGeneration,
  updateGenerationJob,
  updateGenerationJobIfLease,
  getGenerationWithJobsAndImages,
  getGenerationByClientRequestId,
  aggregateGenerationStatus,
  tryClaimPollLease,
  tryClaimQueuedJobForDispatch,
  listDueGenerationJobs,
  markExpiredDispatchingJobOutcomeUnknown,
  requestGenerationCancellation,
} from './generations';
import { createImage } from './images';

const now = '2026-07-12T10:00:00.000Z';

function makeGenParams(overrides: { id?: string; sessionId?: string } = {}) {
  return {
    id: overrides.id ?? 'gen-1',
    sessionId: overrides.sessionId ?? 'default-session',
    prompt: 'A cat',
    status: 'pending' as const,
    createdAt: now,
    updatedAt: now,
  };
}

function makeJobParams(overrides: { id?: string; generationId?: string; status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' } = {}) {
  return {
    id: overrides.id ?? 'job-1',
    generationId: overrides.generationId ?? 'gen-1',
    provider: 'fal' as const,
    model: 'fal-ai/flux/schnell',
    status: overrides.status ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

describe('generations queries', () => {
  it('creates generation and job in same transaction', () => {
    const { db } = createTestDb();
    const { generation, job } = createGenerationAndJob(makeGenParams(), makeJobParams(), db);
    expect(generation.prompt).toBe('A cat');
    expect(job.provider).toBe('fal');
  });

  it('creates every target job in the same transaction', () => {
    const { db } = createTestDb();
    const { jobs } = createGenerationWithJobs(
      makeGenParams(),
      [
        makeJobParams({ id: 'job-fal' }),
        {
          ...makeJobParams({ id: 'job-zenmux' }),
          provider: 'zenmux',
          model: 'openai/gpt-image-2',
        },
      ],
      db,
    );
    expect(jobs.map((job) => job.id)).toEqual(['job-fal', 'job-zenmux']);
  });

  it('atomically creates an idempotent admission and touches its session', () => {
    const { db, sqlite } = createTestDb();
    const result = admitGenerationWithJobs(
      {
        ...makeGenParams(),
        clientRequestId: '018f6f4d-5c3a-7b8c-9d0e-123456789abc',
        requestHash: 'a'.repeat(64),
      },
      [makeJobParams()],
      db,
    );

    expect(result.kind).toBe('created');
    expect(result.generation).toMatchObject({
      id: 'gen-1',
      clientRequestId: '018f6f4d-5c3a-7b8c-9d0e-123456789abc',
      requestHash: 'a'.repeat(64),
    });
    expect(result.jobs.map((job) => job.id)).toEqual(['job-1']);
    expect(
      sqlite
        .prepare('SELECT updated_at FROM sessions WHERE id = ?')
        .get('default-session'),
    ).toEqual({ updated_at: now });
  });

  it('rolls back generation and jobs when the admission session touch fails', () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TRIGGER reject_generation_session_touch
      BEFORE UPDATE ON sessions
      WHEN NEW.id = 'default-session'
      BEGIN
        SELECT RAISE(ABORT, 'session touch rejected');
      END;
    `);

    expect(() =>
      admitGenerationWithJobs(
        {
          ...makeGenParams(),
          clientRequestId: '018f6f4d-5c3a-7b8c-9d0e-123456789abc',
          requestHash: 'a'.repeat(64),
        },
        [makeJobParams()],
        db,
      ),
    ).toThrow('session touch rejected');
    expect(db.select().from(generations).all()).toHaveLength(0);
    expect(db.select().from(generationJobs).all()).toHaveLength(0);
  });

  it('replays the existing generation for the same key and request hash', () => {
    const { db } = createTestDb();
    const clientRequestId = '018f6f4d-5c3a-7b8c-9d0e-123456789abc';
    const requestHash = 'a'.repeat(64);
    const first = admitGenerationWithJobs(
      { ...makeGenParams(), clientRequestId, requestHash },
      [makeJobParams()],
      db,
    );
    const replay = admitGenerationWithJobs(
      {
        ...makeGenParams({ id: 'gen-replay-loser' }),
        clientRequestId,
        requestHash,
      },
      [
        makeJobParams({
          id: 'job-replay-loser',
          generationId: 'gen-replay-loser',
        }),
      ],
      db,
    );

    expect(first.kind).toBe('created');
    expect(replay.kind).toBe('replayed');
    expect(replay.generation.id).toBe('gen-1');
    expect(replay.jobs.map((job) => job.id)).toEqual(['job-1']);
    expect(
      db.select().from(generations).all().map((generation) => generation.id),
    ).toEqual(['gen-1']);
    expect(getGenerationByClientRequestId(clientRequestId, db)).toMatchObject({
      id: 'gen-1',
      requestHash,
    });
  });

  it('reports a hash conflict without creating a second generation or job', () => {
    const { db } = createTestDb();
    const clientRequestId = '018f6f4d-5c3a-7b8c-9d0e-123456789abc';
    admitGenerationWithJobs(
      {
        ...makeGenParams(),
        clientRequestId,
        requestHash: 'a'.repeat(64),
      },
      [makeJobParams()],
      db,
    );

    const conflict = admitGenerationWithJobs(
      {
        ...makeGenParams({ id: 'gen-conflict-loser' }),
        clientRequestId,
        requestHash: 'b'.repeat(64),
      },
      [
        makeJobParams({
          id: 'job-conflict-loser',
          generationId: 'gen-conflict-loser',
        }),
      ],
      db,
    );

    expect(conflict.kind).toBe('conflict');
    expect(conflict.generation.id).toBe('gen-1');
    expect(db.select().from(generations).all()).toHaveLength(1);
    expect(db.select().from(generationJobs).all()).toHaveLength(1);
  });

  it('keeps legacy null request ids outside the partial uniqueness boundary', () => {
    const { db } = createTestDb();
    createGenerationWithJobs(makeGenParams(), [makeJobParams()], db);
    createGenerationWithJobs(
      makeGenParams({ id: 'gen-2' }),
      [makeJobParams({ id: 'job-2', generationId: 'gen-2' })],
      db,
    );

    expect(
      db
        .select()
        .from(generations)
        .all()
        .map((generation) => generation.clientRequestId),
    ).toEqual([null, null]);
  });

  it('returns undefined for missing generation', () => {
    const { db } = createTestDb();
    const result = getGenerationWithJobsAndImages('missing', db);
    expect(result).toBeUndefined();
  });

  it('fetches generation with jobs and images aggregated', () => {
    const { db } = createTestDb();
    createGenerationAndJob(makeGenParams(), makeJobParams(), db);
    createImage(
      {
        id: 'img-1',
        jobId: 'job-1',
        index: 0,
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        width: 1024,
        height: 1024,
        sizeBytes: 1234,
        createdAt: now,
      },
      db,
    );

    const result = getGenerationWithJobsAndImages('gen-1', db);
    expect(result).toBeDefined();
    expect(result!.jobs).toHaveLength(1);
    expect(result!.jobs[0].images).toHaveLength(1);
    expect(result!.images).toHaveLength(1);
  });

  it('updates generation status and updated_at', () => {
    const { db } = createTestDb();
    createGenerationAndJob(makeGenParams(), makeJobParams(), db);
    const later = '2026-07-12T11:00:00.000Z';
    const updated = updateGeneration('gen-1', { status: 'running', updatedAt: later }, db);
    expect(updated.status).toBe('running');
    expect(updated.updatedAt).toBe(later);
  });

  it('updates job status, provider_handle and error', () => {
    const { db } = createTestDb();
    createGenerationAndJob(makeGenParams(), makeJobParams(), db);
    const later = '2026-07-12T11:00:00.000Z';
    const updated = updateGenerationJob(
      'job-1',
      {
        status: 'running',
        providerHandle: JSON.stringify({ requestId: 'r1' }),
        error: JSON.stringify({ code: 'TIMEOUT' }),
        updatedAt: later,
      },
      db,
    );
    expect(updated.status).toBe('running');
    expect(updated.providerHandle).toBe(JSON.stringify({ requestId: 'r1' }));
    expect(updated.error).toBe(JSON.stringify({ code: 'TIMEOUT' }));
    expect(updated.updatedAt).toBe(later);
  });

  it('claims a poll lease once until it expires', () => {
    const { db } = createTestDb();
    createGenerationAndJob(makeGenParams(), makeJobParams({ status: 'running' }), db);
    const now = '2026-07-12T10:00:00.000Z';
    const leaseUntil = '2026-07-12T10:00:35.000Z';
    updateGenerationJob(
      'job-1',
      {
        providerHandle: JSON.stringify({ requestId: 'r1' }),
        updatedAt: now,
      },
      db,
    );

    expect(tryClaimPollLease('job-1', now, leaseUntil, db)).toBe(true);
    expect(tryClaimPollLease('job-1', now, leaseUntil, db)).toBe(false);
    expect(tryClaimPollLease('job-1', '2026-07-12T10:00:36.000Z', '2026-07-12T10:01:11.000Z', db)).toBe(true);

    const job = getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]!;
    expect(job.status).toBe('running');
    expect(job.pollLeaseUntil).toBe('2026-07-12T10:01:11.000Z');
  });

  it('does not turn a handle-less queued row into a polling lease', () => {
    const { db } = createTestDb();
    createGenerationAndJob(makeGenParams(), makeJobParams({ status: 'running' }), db);

    expect(
      tryClaimPollLease('job-1', now, '2026-07-12T10:00:35.000Z', db),
    ).toBe(false);
  });

  it('rejects a stale lease owner from updating a job', () => {
    const { db } = createTestDb();
    createGenerationAndJob(makeGenParams(), makeJobParams({ status: 'running' }), db);
    updateGenerationJob(
      'job-1',
      {
        providerHandle: JSON.stringify({ requestId: 'r1' }),
        updatedAt: now,
      },
      db,
    );
    expect(tryClaimPollLease('job-1', now, '2026-07-12T10:00:35.000Z', db)).toBe(true);
    expect(
      updateGenerationJobIfLease(
        'job-1',
        '2026-07-12T10:00:00.000Z',
        { status: 'failed', pollLeaseUntil: null, updatedAt: now },
        db,
      ),
    ).toBe(false);
    expect(getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]!.status).toBe(
      'running',
    );
  });

  it('claims a due queued job by durably recording dispatching before provider work', () => {
    const { db } = createTestDb();
    createGenerationAndJob(makeGenParams(), makeJobParams(), db);

    expect(
      tryClaimQueuedJobForDispatch(
        'job-1',
        now,
        '2026-07-12T10:00:35.000Z',
        db,
      ),
    ).toBe(true);
    expect(getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]).toMatchObject({
      phase: 'dispatching',
      pollLeaseUntil: '2026-07-12T10:00:35.000Z',
      nextPollAt: null,
    });
  });

  it('lists only due unleased lifecycle jobs in stable order', () => {
    const { db } = createTestDb();
    createGenerationWithJobs(
      makeGenParams(),
      [
        {
          ...makeJobParams({ id: 'job-later' }),
          phase: 'queued',
          nextPollAt: '2026-07-12T10:00:10.000Z',
        },
        {
          ...makeJobParams({ id: 'job-first' }),
          phase: 'queued',
          nextPollAt: '2026-07-12T10:00:00.000Z',
        },
        {
          ...makeJobParams({ id: 'job-leased' }),
          phase: 'queued',
          nextPollAt: '2026-07-12T10:00:00.000Z',
          pollLeaseUntil: '2026-07-12T10:10:00.000Z',
        },
      ],
      db,
    );

    expect(
      listDueGenerationJobs('2026-07-12T10:00:10.000Z', 10, db).map((job) => job.id),
    ).toEqual(['job-first', 'job-later']);
  });

  it('keeps a scheduled retry out of the due set and clears its state on cancellation', () => {
    const { db } = createTestDb();
    createGenerationAndJob(
      makeGenParams(),
      {
        ...makeJobParams(),
        phase: 'polling',
        nextPollAt: '2026-07-12T10:00:10.000Z',
        attemptCount: 1,
        retryStartedAt: now,
      },
      db,
    );
    updateGenerationJob(
      'job-1',
      {
        error: JSON.stringify({ code: 'TIMEOUT', message: 'temporary', retryable: true }),
        updatedAt: now,
      },
      db,
    );

    expect(listDueGenerationJobs(now, 10, db)).toEqual([]);
    expect(
      listDueGenerationJobs('2026-07-12T10:00:10.000Z', 10, db).map((job) => job.id),
    ).toEqual(['job-1']);

    expect(
      requestGenerationCancellation('gen-1', '2026-07-12T10:00:01.000Z', db),
    ).toBe(true);
    expect(getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]).toMatchObject({
      status: 'cancelled',
      phase: 'cancelling',
      error: null,
      attemptCount: 0,
      retryStartedAt: null,
      nextPollAt: '2026-07-12T10:00:01.000Z',
    });
  });

  it('marks an expired dispatch checkpoint as unknown instead of reopening queued work', () => {
    const { db } = createTestDb();
    createGenerationAndJob(
      makeGenParams(),
      {
        ...makeJobParams(),
        phase: 'dispatching',
        pollLeaseUntil: '2026-07-12T10:00:00.000Z',
      },
      db,
    );

    expect(
      markExpiredDispatchingJobOutcomeUnknown(
        'job-1',
        '2026-07-12T10:00:01.000Z',
        JSON.stringify({ code: 'PROVIDER_OUTCOME_UNKNOWN' }),
        db,
      ),
    ).toBe(true);
    expect(getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]).toMatchObject({
      status: 'failed',
      phase: 'outcome_unknown',
    });
  });

  describe('aggregateGenerationStatus', () => {
    it('returns completed for a terminal partial success', () => {
      expect(aggregateGenerationStatus([{ status: 'completed' }, { status: 'failed' }])).toBe('completed');
    });

    it('returns completed when a completed job is paired with a cancelled job', () => {
      expect(aggregateGenerationStatus([{ status: 'cancelled' }, { status: 'completed' }])).toBe('completed');
    });

    it('returns completed when all jobs completed', () => {
      expect(aggregateGenerationStatus([{ status: 'completed' }])).toBe('completed');
    });

    it('returns running if any job running and no failed/cancelled', () => {
      expect(aggregateGenerationStatus([{ status: 'running' }, { status: 'pending' }])).toBe('running');
    });

    it('returns pending otherwise', () => {
      expect(aggregateGenerationStatus([{ status: 'pending' }])).toBe('pending');
    });
  });
});
