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
import {
  createRequestSnapshot,
  REQUEST_SNAPSHOT_VERSION,
} from './request-snapshot';
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
    db.update(generationJobs)
      .set({
        providerHandle: JSON.stringify({
          providerId: 'kling',
          model: 'kling-v3',
          externalId: 'kling-task',
          statusUrl: 'https://status.example.test/kling-task',
          responseUrl: 'https://response.example.test/kling-task',
          cancelUrl: null,
          submittedAt: now,
        }),
      })
      .where(eq(generationJobs.id, 'job-cancel'))
      .run();
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

    await expect(
      advance(getGenerationJob('job-cancel', db)!, db),
    ).resolves.toBe('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    expect(getGenerationJob('job-cancel', db)?.phase).toBe('terminal');
    expect(getGenerationWithJobsAndImages('gen-cancel', db)?.status).toBe(
      'cancelled',
    );
  });

  it('keeps local cancellation terminal with a safe diagnostic when remote cancel is unsupported', async () => {
    const { db } = createTestDb();
    seedJob(db, { handle: true });
    vi.mocked(providers.getById).mockReturnValue({
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit: vi.fn(),
    } as ImageProvider);

    await cancelGeneration('gen-cancel', { db });
    await expect(
      advance(getGenerationJob('job-cancel', db)!, db),
    ).resolves.toBe('cancelled');

    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      status: 'cancelled',
      phase: 'terminal',
      error: expect.stringContaining('CANCEL_UNSUPPORTED'),
      pollLeaseUntil: null,
      nextPollAt: null,
      attemptCount: 0,
      retryStartedAt: null,
    });
    expect(getGenerationWithJobsAndImages('gen-cancel', db)?.status).toBe(
      'cancelled',
    );
  });

  it('clears a prior poll retry diagnostic as soon as cancellation wins locally', async () => {
    const { db } = createTestDb();
    seedJob(db, { handle: true });
    db.update(generationJobs)
      .set({
        attemptCount: 1,
        retryStartedAt: '2026-07-20T00:00:00.000Z',
        error: JSON.stringify({
          code: 'TIMEOUT',
          message: 'temporary',
          retryable: true,
        }),
      })
      .where(eq(generationJobs.id, 'job-cancel'))
      .run();

    await cancelGeneration('gen-cancel', { db });

    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      status: 'cancelled',
      phase: 'cancelling',
      error: null,
      attemptCount: 0,
      retryStartedAt: null,
    });
  });

  it('retries a retryable remote cancellation and clears retry state after confirmation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      seedJob(db, { handle: true });
      const cancel = vi
        .fn()
        .mockResolvedValueOnce({
          status: 'failed',
          error: {
            code: 'TIMEOUT',
            message: 'temporary outage',
            retryable: true,
          },
        })
        .mockResolvedValueOnce({ status: 'cancelled' });
      vi.mocked(providers.getById).mockReturnValue({
        id: 'kling',
        displayName: 'Kling AI',
        capabilities: new Map(),
        submit: vi.fn(),
        cancel,
      } as ImageProvider);

      await cancelGeneration('gen-cancel', { db });
      await expect(
        advance(getGenerationJob('job-cancel', db)!, db),
      ).resolves.toBe('retried');
      const scheduled = getGenerationJob('job-cancel', db)!;
      expect(scheduled).toMatchObject({
        status: 'cancelled',
        phase: 'cancelling',
        pollLeaseUntil: null,
        attemptCount: 1,
        retryStartedAt: '2026-07-20T00:00:00.000Z',
        nextPollAt: '2026-07-20T00:00:00.250Z',
        error: expect.stringContaining('TIMEOUT'),
      });

      await expect(advance(scheduled, db)).resolves.toBe('skipped');
      expect(cancel).toHaveBeenCalledOnce();

      vi.setSystemTime(new Date(scheduled.nextPollAt!));
      await expect(
        advance(getGenerationJob('job-cancel', db)!, db),
      ).resolves.toBe('cancelled');
      expect(getGenerationJob('job-cancel', db)).toMatchObject({
        status: 'cancelled',
        phase: 'terminal',
        error: null,
        attemptCount: 0,
        retryStartedAt: null,
        nextPollAt: null,
      });
      expect(cancel).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each(['pending', 'running'] as const)(
    'keeps the local cancellation durable while remote cancel reports %s',
    async (remoteStatus) => {
      const { db } = createTestDb();
      seedJob(db, { handle: true });
      const cancel = vi.fn().mockResolvedValue({ status: remoteStatus });
      vi.mocked(providers.getById).mockReturnValue({
        id: 'kling',
        displayName: 'Kling AI',
        capabilities: new Map(),
        submit: vi.fn(),
        cancel,
      } as ImageProvider);

      await cancelGeneration('gen-cancel', { db });
      await expect(
        advance(getGenerationJob('job-cancel', db)!, db),
      ).resolves.toBe('retried');

      expect(getGenerationJob('job-cancel', db)).toMatchObject({
        status: 'cancelled',
        phase: 'cancelling',
        pollLeaseUntil: null,
        attemptCount: 1,
        retryStartedAt: expect.any(String),
        nextPollAt: expect.any(String),
        error: expect.stringContaining('CANCEL_UNCONFIRMED'),
      });
      expect(getGenerationWithJobsAndImages('gen-cancel', db)?.status).toBe(
        'cancelled',
      );
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it('turns a malformed remote cancellation result into a bounded retry checkpoint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      seedJob(db, { handle: true });
      const cancel = vi.fn().mockResolvedValue(undefined);
      vi.mocked(providers.getById).mockReturnValue({
        id: 'kling',
        displayName: 'Kling AI',
        capabilities: new Map(),
        submit: vi.fn(),
        cancel,
      } as ImageProvider);

      await cancelGeneration('gen-cancel', { db });
      await expect(
        advance(getGenerationJob('job-cancel', db)!, db),
      ).resolves.toBe('retried');
      expect(getGenerationJob('job-cancel', db)).toMatchObject({
        status: 'cancelled',
        phase: 'cancelling',
        pollLeaseUntil: null,
        attemptCount: 1,
        retryStartedAt: '2026-07-20T00:00:00.000Z',
        nextPollAt: '2026-07-20T00:00:00.250Z',
        error: expect.stringContaining('PROVIDER_ERROR'),
      });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not silently claim remote cancellation when the remote job already completed', async () => {
    const { db } = createTestDb();
    seedJob(db, { handle: true });
    const cancel = vi
      .fn()
      .mockResolvedValue({ status: 'completed', images: [] });
    vi.mocked(providers.getById).mockReturnValue({
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit: vi.fn(),
      cancel,
    } as ImageProvider);

    await cancelGeneration('gen-cancel', { db });
    await expect(
      advance(getGenerationJob('job-cancel', db)!, db),
    ).resolves.toBe('cancelled');

    expect(getGenerationJob('job-cancel', db)).toMatchObject({
      status: 'cancelled',
      phase: 'terminal',
      error: expect.stringContaining('CANCEL_UNCONFIRMED'),
      nextPollAt: null,
      pollLeaseUntil: null,
      attemptCount: 0,
      retryStartedAt: null,
    });
    expect(getGenerationWithJobsAndImages('gen-cancel', db)).toMatchObject({
      status: 'cancelled',
      images: [],
    });
  });

  it('stops after the third remote cancellation failure but keeps the generation cancelled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    try {
      const { db } = createTestDb();
      seedJob(db, { handle: true });
      const cancel = vi.fn().mockResolvedValue({
        status: 'failed',
        error: { code: 'TIMEOUT', message: 'still down', retryable: true },
      });
      vi.mocked(providers.getById).mockReturnValue({
        id: 'kling',
        displayName: 'Kling AI',
        capabilities: new Map(),
        submit: vi.fn(),
        cancel,
      } as ImageProvider);

      await cancelGeneration('gen-cancel', { db });
      db.update(generationJobs)
        .set({
          attemptCount: 2,
          retryStartedAt: '2026-07-20T00:00:00.000Z',
        })
        .where(eq(generationJobs.id, 'job-cancel'))
        .run();

      await expect(
        advance(getGenerationJob('job-cancel', db)!, db),
      ).resolves.toBe('cancelled');
      expect(getGenerationJob('job-cancel', db)).toMatchObject({
        status: 'cancelled',
        phase: 'terminal',
        error: expect.stringContaining('RETRY_EXHAUSTED'),
        nextPollAt: null,
        pollLeaseUntil: null,
        attemptCount: 0,
        retryStartedAt: null,
      });
      expect(getGenerationWithJobsAndImages('gen-cancel', db)?.status).toBe(
        'cancelled',
      );
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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

    await expect(
      advance(getGenerationJob('job-cancel', db)!, db),
    ).resolves.toBe('cancelled');
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
      [
        { ...job, id: 'job-first' },
        { ...job, id: 'job-second' },
      ],
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
    expect(
      getGenerationWithJobsAndImages('gen-fanout-cancel', db),
    ).toMatchObject({
      status: 'pending',
      jobs: [
        { id: 'job-first', status: 'pending', cancelRequestedAt: null },
        { id: 'job-second', status: 'pending', cancelRequestedAt: null },
      ],
    });
  });
});
