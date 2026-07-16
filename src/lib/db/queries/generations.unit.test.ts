import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/db';
import {
  createGenerationAndJob,
  createGenerationWithJobs,
  updateGeneration,
  updateGenerationJob,
  getGenerationWithJobsAndImages,
  aggregateGenerationStatus,
  tryClaimPollLease,
} from './generations';
import { createImage } from './images';

const now = '2026-07-12T10:00:00.000Z';

function makeGenParams(overrides: { id?: string; sessionId?: string | null } = {}) {
  return {
    id: overrides.id ?? 'gen-1',
    sessionId: overrides.sessionId ?? null,
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

    expect(tryClaimPollLease('job-1', now, leaseUntil, db)).toBe(true);
    expect(tryClaimPollLease('job-1', now, leaseUntil, db)).toBe(false);
    expect(tryClaimPollLease('job-1', '2026-07-12T10:00:36.000Z', '2026-07-12T10:01:11.000Z', db)).toBe(true);

    const job = getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]!;
    expect(job.status).toBe('running');
    expect(job.pollLeaseUntil).toBe('2026-07-12T10:01:11.000Z');
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
