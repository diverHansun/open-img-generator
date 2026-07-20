import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../tests/helpers/db';
import {
  createGenerationAndJob,
  createGenerationWithJobs,
  generationJobs,
  getGenerationJob,
  getGenerationWithJobsAndImages,
} from '../db';
import type { ImageProvider } from '../providers';
import * as providers from '../providers';
import { advance } from './lifecycle';
import { cancelGeneration } from './orchestrator';
import { createRequestSnapshot, REQUEST_SNAPSHOT_VERSION } from './request-snapshot';
import { resetProviderLimiters, withProviderLimit } from '../providers/limiter';

vi.mock('../providers', () => ({ getById: vi.fn() }));

const now = '2026-07-12T10:00:00.000Z';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function seedJob(
  db: ReturnType<typeof createTestDb>['db'],
  options: { handle?: boolean } = {},
) {
  createGenerationAndJob(
    {
      id: 'gen-cancel',
      sessionId: 'default-session',
      prompt: 'cancel test',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'job-cancel',
      generationId: 'gen-cancel',
      provider: 'kling',
      model: 'kling-v3',
      status: options.handle ? 'running' : 'pending',
      phase: options.handle ? 'polling' : 'queued',
      requestSnapshot: createRequestSnapshot({ prompt: 'cancel test' }),
      requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
      createdAt: now,
      updatedAt: now,
    },
    db,
  );
  // createGenerationAndJob intentionally starts no handle. Set it via a
  // direct update only for the cancellation recovery checkpoint fixture.
  if (options.handle) {
    db.update(generationJobs).set({
      providerHandle: JSON.stringify({
        providerId: 'kling',
        model: 'kling-v3',
        externalId: 'kling-task',
        statusUrl: 'https://status.example.test/kling-task',
        responseUrl: 'https://response.example.test/kling-task',
        cancelUrl: null,
        submittedAt: now,
      }),
    }).where(eq(generationJobs.id, 'job-cancel')).run();
  }
}

describe('durable cancellation', () => {
  beforeEach(() => {
    vi.mocked(providers.getById).mockReset();
    resetProviderLimiters();
    delete process.env.MAX_INFLIGHT_PER_PROVIDER;
  });

  it('cancels a queued job locally without calling any provider', async () => {
    const { db } = createTestDb();
    seedJob(db);

    const view = await cancelGeneration('gen-cancel', { db });

    expect(view.status).toBe('cancelled');
    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      status: 'cancelled',
      phase: 'terminal',
      cancelRequestedAt: expect.any(String),
    });
    expect(providers.getById).not.toHaveBeenCalled();
  });

  it('returns local cancellation before a worker performs best-effort remote cancellation', async () => {
    const { db } = createTestDb();
    seedJob(db, { handle: true });
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' });
    const provider: ImageProvider = {
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit: vi.fn(),
      cancel,
    };
    vi.mocked(providers.getById).mockReturnValue(provider);

    const view = await cancelGeneration('gen-cancel', { db });
    expect(view.status).toBe('cancelled');
    expect(cancel).not.toHaveBeenCalled();
    expect(getGenerationJob('job-cancel', db)?.phase).toBe('cancelling');

    await expect(advance(getGenerationJob('job-cancel', db)!, db)).resolves.toBe('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    expect(getGenerationJob('job-cancel', db)?.phase).toBe('terminal');
    expect(getGenerationWithJobsAndImages('gen-cancel', db)?.status).toBe('cancelled');
  });

  it('persists a late dispatch handle under cancellation and then remote-cancels it', async () => {
    const { db } = createTestDb();
    seedJob(db);
    const submitStarted = deferred<void>();
    const submitResult = deferred<{
      kind: 'async';
      handle: {
        providerId: 'kling';
        model: string;
        externalId: string;
        statusUrl: string;
        responseUrl: string;
        cancelUrl: null;
        submittedAt: string;
      };
    }>();
    const submit = vi.fn(async () => {
      submitStarted.resolve();
      return submitResult.promise;
    });
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' });
    vi.mocked(providers.getById).mockReturnValue({
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit,
      cancel,
    } as ImageProvider);

    const dispatch = advance(getGenerationJob('job-cancel', db)!, db);
    await submitStarted.promise;
    const cancelled = await cancelGeneration('gen-cancel', { db });
    expect(cancelled.status).toBe('cancelled');
    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      phase: 'cancelling',
      status: 'cancelled',
      providerHandle: null,
      requestSnapshot: null,
      requestSnapshotVersion: null,
    });

    submitResult.resolve({
      kind: 'async',
      handle: {
        providerId: 'kling',
        model: 'kling-v3',
        externalId: 'late-handle',
        statusUrl: 'https://status.example.test/late-handle',
        responseUrl: 'https://response.example.test/late-handle',
        cancelUrl: null,
        submittedAt: now,
      },
    });
    await expect(dispatch).resolves.toBe('advanced');
    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      phase: 'cancelling',
      status: 'cancelled',
      providerHandle: expect.stringContaining('late-handle'),
      pollLeaseUntil: null,
    });

    await expect(advance(getGenerationJob('job-cancel', db)!, db)).resolves.toBe('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      phase: 'terminal',
      requestSnapshot: null,
      requestSnapshotVersion: null,
      resultSnapshot: null,
    });
  });

  it('does not invoke a limiter-queued provider submit after cancellation wins', async () => {
    const { db } = createTestDb();
    seedJob(db);
    process.env.MAX_INFLIGHT_PER_PROVIDER = '1';
    const blocker = deferred<void>();
    const holdSlot = withProviderLimit('kling', async () => blocker.promise);
    const submit = vi.fn();
    vi.mocked(providers.getById).mockReturnValue({
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit,
    } as ImageProvider);

    const dispatch = advance(getGenerationJob('job-cancel', db)!, db);
    expect(getGenerationJob('job-cancel', db)?.phase).toBe('dispatching');
    await cancelGeneration('gen-cancel', { db });
    blocker.resolve();
    await holdSlot;

    await expect(dispatch).resolves.toBe('cancelled');
    expect(submit).not.toHaveBeenCalled();
    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      phase: 'terminal',
      status: 'cancelled',
    });
  });

  it('rolls back every fan-out cancellation when one row update fails', async () => {
    const { db, sqlite } = createTestDb();
    const job = {
      generationId: 'gen-fanout-cancel',
      provider: 'kling',
      model: 'kling-v3',
      status: 'pending' as const,
      phase: 'queued' as const,
      requestSnapshot: createRequestSnapshot({ prompt: 'cancel fanout' }),
      requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    createGenerationWithJobs(
      {
        id: 'gen-fanout-cancel',
        sessionId: 'default-session',
        prompt: 'cancel fanout',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      [{ ...job, id: 'job-first' }, { ...job, id: 'job-second' }],
      db,
    );
    sqlite.exec(`
      CREATE TRIGGER reject_second_cancel
      BEFORE UPDATE ON generation_jobs
      WHEN NEW.id = 'job-second' AND NEW.cancel_requested_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'second cancellation rejected');
      END;
    `);

    await expect(cancelGeneration('gen-fanout-cancel', { db })).rejects.toThrow(
      'second cancellation rejected',
    );
    expect(getGenerationWithJobsAndImages('gen-fanout-cancel', db)).toMatchObject({
      status: 'pending',
      jobs: [
        { id: 'job-first', status: 'pending', cancelRequestedAt: null },
        { id: 'job-second', status: 'pending', cancelRequestedAt: null },
      ],
    });
  });
});
