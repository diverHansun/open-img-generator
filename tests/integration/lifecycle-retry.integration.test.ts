import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createIntegrationDb } from '../helpers/integration';
import * as schema from '../../src/lib/db/schema';
import { createGenerationAndJob, getGenerationJob } from '../../src/lib/db';
import { POLL_INTERVAL_MS, advance } from '../../src/lib/job-engine/lifecycle';
import { cancelGeneration } from '../../src/lib/job-engine/orchestrator';
import {
  createRequestSnapshot,
  REQUEST_SNAPSHOT_VERSION,
} from '../../src/lib/job-engine/request-snapshot';
import type { ImageProvider, PollResult, SubmitResult } from '../../src/lib/providers';
import * as providers from '../../src/lib/providers';
import { runWorkerOnce } from '../../src/lib/job-engine/worker';

vi.mock('../../src/lib/providers', () => ({ getById: vi.fn() }));

const { tempFile, cleanup } = createIntegrationDb();
const start = new Date('2026-07-20T12:00:00.000Z');

function openFileBackedDb() {
  const sqlite = new Database(tempFile);
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function retryProvider(poll: ImageProvider['poll']): ImageProvider {
  return {
    id: 'fal',
    displayName: 'fal.ai',
    capabilities: new Map(),
    submit: vi.fn(),
    poll,
  } as ImageProvider;
}

function cancellationProvider(
  cancel: NonNullable<ImageProvider['cancel']>,
): ImageProvider {
  return {
    id: 'fal',
    displayName: 'fal.ai',
    capabilities: new Map(),
    submit: vi.fn(),
    cancel,
  } as ImageProvider;
}

describe('durable polling retry recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    vi.mocked(providers.getById).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    cleanup();
  });

  it('recovers a persisted poll retry after reopening SQLite and clears it on a successful poll', async () => {
    const poll = vi
      .fn<NonNullable<ImageProvider['poll']>>()
      .mockResolvedValueOnce({
        status: 'failed',
        error: {
          code: 'TIMEOUT',
          message: 'temporary provider timeout',
          retryable: true,
        },
      } satisfies PollResult)
      .mockResolvedValueOnce({ status: 'running' } satisfies PollResult);
    vi.mocked(providers.getById).mockReturnValue(retryProvider(poll));

    const first = openFileBackedDb();
    let retryDueAt: string;
    try {
      createGenerationAndJob(
        {
          id: 'gen-retry-restart',
          sessionId: 'default-session',
          prompt: 'A rain-soaked botanical conservatory',
          status: 'pending',
          createdAt: start.toISOString(),
          updatedAt: start.toISOString(),
        },
        {
          id: 'job-retry-restart',
          generationId: 'gen-retry-restart',
          provider: 'fal',
          model: 'fal-ai/flux/schnell',
          status: 'pending',
          phase: 'polling',
          requestSnapshot: createRequestSnapshot({
            prompt: 'A rain-soaked botanical conservatory',
          }),
          requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
          nextPollAt: start.toISOString(),
          createdAt: start.toISOString(),
          updatedAt: start.toISOString(),
        },
        first.db,
      );
      // Generation creation deliberately never accepts a handle. This is the
      // durable async-job checkpoint a process would reopen after a restart.
      first.sqlite
        .prepare(
          `
        UPDATE generation_jobs
        SET provider_handle = ?
        WHERE id = ?
      `,
        )
        .run(
          JSON.stringify({
            providerId: 'fal',
            model: 'fal-ai/flux/schnell',
            externalId: 'retry-restart-handle',
            statusUrl: 'https://status.example.test/retry-restart-handle',
            responseUrl: 'https://response.example.test/retry-restart-handle',
            cancelUrl: null,
            submittedAt: start.toISOString(),
          }),
          'job-retry-restart',
        );

      await expect(
        advance(getGenerationJob('job-retry-restart', first.db)!, first.db),
      ).resolves.toBe('retried');

      const afterFailure = getGenerationJob('job-retry-restart', first.db)!;
      expect(afterFailure).toMatchObject({
        status: 'pending',
        phase: 'polling',
        attemptCount: 1,
        retryStartedAt: start.toISOString(),
        pollLeaseUntil: null,
        error: expect.stringContaining('TIMEOUT'),
      });
      expect(afterFailure.nextPollAt).toEqual(expect.any(String));
      expect(Date.parse(afterFailure.nextPollAt!)).toBeGreaterThan(
        start.getTime(),
      );
      retryDueAt = afterFailure.nextPollAt!;
    } finally {
      first.sqlite.close();
    }

    // A new process owns a new SQLite connection, but sees the first process's
    // persisted due time, retry budget, and diagnostic.
    const reopened = openFileBackedDb();
    try {
      const afterRestart = getGenerationJob('job-retry-restart', reopened.db)!;
      expect(afterRestart).toMatchObject({
        attemptCount: 1,
        retryStartedAt: start.toISOString(),
        nextPollAt: retryDueAt,
      });

      vi.setSystemTime(new Date(retryDueAt));
      await expect(
        advance(
          getGenerationJob('job-retry-restart', reopened.db)!,
          reopened.db,
        ),
      ).resolves.toBe('advanced');

      const afterRecovery = getGenerationJob('job-retry-restart', reopened.db)!;
      expect(afterRecovery).toMatchObject({
        status: 'running',
        phase: 'polling',
        error: null,
        attemptCount: 0,
        retryStartedAt: null,
        pollLeaseUntil: null,
      });
      expect(Date.parse(afterRecovery.nextPollAt!)).toBe(
        Date.parse(retryDueAt) + POLL_INTERVAL_MS,
      );
      expect(poll).toHaveBeenCalledTimes(2);
    } finally {
      reopened.sqlite.close();
    }
  });

  it('recovers an explicit Provider rate-limit wait after reopening SQLite', async () => {
    const submit = vi
      .fn<() => Promise<SubmitResult>>()
      .mockResolvedValueOnce({
        kind: 'failed',
        error: {
          code: 'RATE_LIMITED',
          message: 'provider busy',
          retryable: true,
          disposition: 'rejected',
          retryAfterMs: 5_000,
        },
      })
      .mockResolvedValueOnce({
        kind: 'async',
        handle: {
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'accepted-after-restart',
          statusUrl: 'https://status.example.test/accepted-after-restart',
          responseUrl: 'https://response.example.test/accepted-after-restart',
          cancelUrl: null,
          submittedAt: start.toISOString(),
        },
      });
    vi.mocked(providers.getById).mockReturnValue({
      id: 'fal',
      displayName: 'fal.ai',
      capabilities: new Map(),
      submit,
    });

    const first = openFileBackedDb();
    let retryDueAt: string;
    try {
      createGenerationAndJob(
        {
          id: 'gen-rate-limit-restart',
          sessionId: 'default-session',
          prompt: 'A quiet observatory',
          status: 'pending',
          createdAt: start.toISOString(),
          updatedAt: start.toISOString(),
        },
        {
          id: 'job-rate-limit-restart',
          generationId: 'gen-rate-limit-restart',
          provider: 'fal',
          model: 'fal-ai/flux/schnell',
          status: 'pending',
          phase: 'queued',
          requestSnapshot: createRequestSnapshot({ prompt: 'A quiet observatory' }),
          requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
          nextPollAt: start.toISOString(),
          createdAt: start.toISOString(),
          updatedAt: start.toISOString(),
        },
        first.db,
      );

      await expect(
        advance(getGenerationJob('job-rate-limit-restart', first.db)!, first.db),
      ).resolves.toBe('retried');
      const waiting = getGenerationJob('job-rate-limit-restart', first.db)!;
      expect(waiting).toMatchObject({
        status: 'pending',
        phase: 'queued',
        attemptCount: 0,
        retryStartedAt: null,
        error: expect.stringContaining('RATE_LIMITED'),
      });
      retryDueAt = waiting.nextPollAt!;
    } finally {
      first.sqlite.close();
    }

    const reopened = openFileBackedDb();
    try {
      expect(getGenerationJob('job-rate-limit-restart', reopened.db)).toMatchObject({
        phase: 'queued',
        nextPollAt: retryDueAt,
        error: expect.stringContaining('RATE_LIMITED'),
      });
      vi.setSystemTime(new Date(retryDueAt));
      await expect(
        advance(getGenerationJob('job-rate-limit-restart', reopened.db)!, reopened.db),
      ).resolves.toBe('advanced');
      expect(getGenerationJob('job-rate-limit-restart', reopened.db)).toMatchObject({
        phase: 'polling',
        error: null,
        attemptCount: 0,
        retryStartedAt: null,
      });
      expect(submit).toHaveBeenCalledTimes(2);
    } finally {
      reopened.sqlite.close();
    }
  });

  it('recovers from an immediately restarted cancellation marker and its remote retry checkpoint', async () => {
    const cancel = vi
      .fn<NonNullable<ImageProvider['cancel']>>()
      .mockResolvedValueOnce({
        status: 'failed',
        error: {
          code: 'TIMEOUT',
          message:
            'private cancel detail https://signed.example/cancel?token=secret',
          retryable: true,
        },
      } satisfies PollResult)
      .mockResolvedValueOnce({ status: 'cancelled' } satisfies PollResult);
    vi.mocked(providers.getById).mockReturnValue(cancellationProvider(cancel));

    const first = openFileBackedDb();
    try {
      createGenerationAndJob(
        {
          id: 'gen-cancel-retry-restart',
          sessionId: 'default-session',
          prompt: 'A rain-soaked botanical conservatory',
          status: 'running',
          createdAt: start.toISOString(),
          updatedAt: start.toISOString(),
        },
        {
          id: 'job-cancel-retry-restart',
          generationId: 'gen-cancel-retry-restart',
          provider: 'fal',
          model: 'fal-ai/flux/schnell',
          status: 'running',
          phase: 'polling',
          requestSnapshot: createRequestSnapshot({
            prompt: 'A rain-soaked botanical conservatory',
          }),
          requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
          nextPollAt: start.toISOString(),
          createdAt: start.toISOString(),
          updatedAt: start.toISOString(),
        },
        first.db,
      );
      first.sqlite
        .prepare(
          `
        UPDATE generation_jobs
        SET provider_handle = ?
        WHERE id = ?
      `,
        )
        .run(
          JSON.stringify({
            providerId: 'fal',
            model: 'fal-ai/flux/schnell',
            externalId: 'cancel-retry-restart-handle',
            statusUrl:
              'https://status.example.test/cancel-retry-restart-handle',
            responseUrl:
              'https://response.example.test/cancel-retry-restart-handle',
            cancelUrl: null,
            submittedAt: start.toISOString(),
          }),
          'job-cancel-retry-restart',
        );

      await expect(
        cancelGeneration('gen-cancel-retry-restart', { db: first.db }),
      ).resolves.toMatchObject({ status: 'cancelled' });
      expect(getGenerationJob('job-cancel-retry-restart', first.db)).toMatchObject({
        status: 'cancelled',
        phase: 'cancelling',
      });
    } finally {
      first.sqlite.close();
    }

    // The API process can exit immediately after committing the marker. A
    // fresh worker must perform the first remote cancellation and persist its
    // retry checkpoint, not rely on an in-memory timer from the API process.
    const afterMarkerRestart = openFileBackedDb();
    let retryDueAt: string;
    try {
      await expect(runWorkerOnce({ db: afterMarkerRestart.db })).resolves.toMatchObject({
        scanned: 1,
        retried: 1,
      });
      const afterFailure = getGenerationJob(
        'job-cancel-retry-restart',
        afterMarkerRestart.db,
      )!;
      expect(afterFailure).toMatchObject({
        status: 'cancelled',
        phase: 'cancelling',
        attemptCount: 1,
        retryStartedAt: start.toISOString(),
        pollLeaseUntil: null,
        error: expect.stringContaining('TIMEOUT'),
      });
      expect(afterFailure.error).not.toContain('signed.example');
      retryDueAt = afterFailure.nextPollAt!;
    } finally {
      afterMarkerRestart.sqlite.close();
    }

    const reopened = openFileBackedDb();
    try {
      expect(
        getGenerationJob('job-cancel-retry-restart', reopened.db),
      ).toMatchObject({
        attemptCount: 1,
        retryStartedAt: start.toISOString(),
        nextPollAt: retryDueAt,
      });

      vi.setSystemTime(new Date(retryDueAt));
      await expect(
        runWorkerOnce({ db: reopened.db }),
      ).resolves.toMatchObject({ scanned: 1, cancelled: 1 });

      expect(
        getGenerationJob('job-cancel-retry-restart', reopened.db),
      ).toMatchObject({
        status: 'cancelled',
        phase: 'terminal',
        error: null,
        attemptCount: 0,
        retryStartedAt: null,
        nextPollAt: null,
        pollLeaseUntil: null,
      });
      expect(cancel).toHaveBeenCalledTimes(2);
    } finally {
      reopened.sqlite.close();
    }
  });
});
