import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../tests/helpers/db';
import {
  createGenerationAndJob,
  getGenerationJob,
  getGenerationWithJobsAndImages,
  generationJobs,
  updateGenerationJob,
} from '../db';
import type { ImageProvider, PollResult, SubmitResult } from '../providers';
import * as providers from '../providers';
import * as storage from '../storage';
import {
  createRequestSnapshot,
  REQUEST_SNAPSHOT_VERSION,
} from './request-snapshot';
import { advance } from './lifecycle';
import { cancelGeneration } from './orchestrator';

vi.mock('../providers', () => ({ getById: vi.fn() }));
vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
  downloadAndStore: vi.fn(),
  removeStoredFile: vi.fn(),
  stageInlineImage: vi.fn(),
  removeStagedImage: vi.fn(),
}));

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

function provider(overrides: Partial<ImageProvider> = {}): ImageProvider {
  return {
    id: 'fal',
    displayName: 'fal.ai',
    capabilities: new Map(),
    submit: vi.fn(),
    ...overrides,
  } as ImageProvider;
}

function seedJob(
  db: ReturnType<typeof createTestDb>['db'],
  patch: Record<string, unknown> = {},
) {
  createGenerationAndJob(
    {
      id: 'gen-1',
      sessionId: 'default-session',
      prompt: 'A cat',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'job-1',
      generationId: 'gen-1',
      provider: 'fal',
      model: 'fal-ai/flux/schnell',
      status: 'pending',
      phase: 'queued',
      requestSnapshot: createRequestSnapshot({ prompt: 'A cat', count: 2 }),
      requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
      nextPollAt: '2000-01-01T00:00:00.000Z',
      createdAt: now,
      updatedAt: now,
    },
    db,
  );
  if (Object.keys(patch).length > 0) {
    db.update(generationJobs)
      .set(patch)
      .where(eq(generationJobs.id, 'job-1'))
      .run();
  }
  return getGenerationJob('job-1', db)!;
}

describe('durable lifecycle', () => {
  beforeEach(() => {
    vi.mocked(providers.getById).mockReset();
    vi.mocked(storage.downloadAndStore).mockReset();
    vi.mocked(storage.removeStoredFile).mockReset();
    vi.mocked(storage.stageInlineImage).mockReset();
    vi.mocked(storage.removeStagedImage).mockReset();
  });

  it('claims queued dispatch once and persists the async handle', async () => {
    const { db } = createTestDb();
    const submit = vi.fn().mockResolvedValue({
      kind: 'async',
      handle: {
        providerId: 'fal',
        model: 'fal-ai/flux/schnell',
        externalId: 'request-1',
        statusUrl: 'https://status.example.test/request-1',
        responseUrl: 'https://response.example.test/request-1',
        cancelUrl: null,
        submittedAt: now,
      },
    });
    vi.mocked(providers.getById).mockReturnValue(provider({ submit }));
    const job = seedJob(db);

    const [first, second] = await Promise.all([
      advance(job, db),
      advance(job, db),
    ]);

    expect([first, second].sort()).toEqual(['advanced', 'skipped']);
    expect(submit).toHaveBeenCalledOnce();
    expect(getGenerationJob(job.id, db)).toMatchObject({
      phase: 'polling',
      status: 'pending',
      providerHandle: expect.stringContaining('request-1'),
      pollLeaseUntil: null,
    });
  });

  it('turns an expired dispatch lease into outcome_unknown without a second submit', async () => {
    const { db } = createTestDb();
    const submit = vi.fn();
    vi.mocked(providers.getById).mockReturnValue(provider({ submit }));
    const job = seedJob(db, {
      phase: 'dispatching',
      pollLeaseUntil: '2000-01-01T00:00:00.000Z',
    });

    await expect(advance(job, db)).resolves.toBe('unknown');
    expect(submit).not.toHaveBeenCalled();
    expect(getGenerationJob(job.id, db)).toMatchObject({
      status: 'failed',
      phase: 'outcome_unknown',
      error: expect.stringContaining('PROVIDER_OUTCOME_UNKNOWN'),
      requestSnapshot: null,
      requestSnapshotVersion: null,
      resultSnapshot: null,
    });
  });

  it('scrubs snapshots when an in-flight provider submit has an unknown outcome', async () => {
    const { db } = createTestDb();
    const job = seedJob(db);
    vi.mocked(providers.getById).mockReturnValue(
      provider({
        submit: vi.fn().mockRejectedValue(new Error('connection reset')),
      }),
    );

    await expect(advance(job, db)).resolves.toBe('unknown');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      status: 'failed',
      phase: 'outcome_unknown',
      requestSnapshot: null,
      requestSnapshotVersion: null,
      resultSnapshot: null,
      attemptCount: 0,
      retryStartedAt: null,
    });
  });

  it('requeues only an explicitly rejected retryable submit and honors Retry-After', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      const submit = vi
        .fn<() => Promise<SubmitResult>>()
        .mockResolvedValueOnce({
          kind: 'failed',
          error: {
            code: 'RATE_LIMITED',
            message: 'retry later',
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
            externalId: 'accepted-after-wait',
            statusUrl: 'https://status.example.test/accepted-after-wait',
            responseUrl: 'https://response.example.test/accepted-after-wait',
            cancelUrl: null,
            submittedAt: now,
          },
        });
      vi.mocked(providers.getById).mockReturnValue(provider({ submit }));
      const job = seedJob(db);

      await expect(advance(job, db)).resolves.toBe('retried');
      const scheduled = getGenerationJob(job.id, db)!;
      expect(scheduled).toMatchObject({
        phase: 'queued',
        status: 'pending',
        attemptCount: 1,
        nextPollAt: '2026-07-20T00:00:05.000Z',
        error: expect.stringContaining('RATE_LIMITED'),
      });
      expect(submit).toHaveBeenCalledOnce();

      await expect(advance(scheduled, db)).resolves.toBe('skipped');
      vi.setSystemTime(new Date(scheduled.nextPollAt!));
      await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe('advanced');
      expect(submit).toHaveBeenCalledTimes(2);
      expect(getGenerationJob(job.id, db)).toMatchObject({
        phase: 'polling',
        attemptCount: 0,
        retryStartedAt: null,
      });
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not replay a submit whose provider outcome is unknown', async () => {
    const { db } = createTestDb();
    const submit = vi.fn<() => Promise<SubmitResult>>().mockResolvedValue({
      kind: 'failed',
      error: {
        code: 'PROVIDER_ERROR',
        message: 'connection failed after send',
        retryable: true,
        disposition: 'unknown',
      },
    });
    vi.mocked(providers.getById).mockReturnValue(provider({ submit }));
    const job = seedJob(db);

    await expect(advance(job, db)).resolves.toBe('unknown');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      phase: 'outcome_unknown',
      status: 'failed',
      nextPollAt: null,
      error: expect.stringContaining('PROVIDER_OUTCOME_UNKNOWN'),
    });
    await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe('skipped');
    expect(submit).toHaveBeenCalledOnce();
  });

  it('does not regress public running status when a poll returns pending', async () => {
    const { db } = createTestDb();
    const job = seedJob(db, {
      phase: 'polling',
      status: 'running',
      providerHandle: JSON.stringify({
        providerId: 'fal',
        model: 'fal-ai/flux/schnell',
        externalId: 'request-1',
        statusUrl: 'https://status.example.test/request-1',
        responseUrl: 'https://response.example.test/request-1',
        cancelUrl: null,
        submittedAt: now,
      }),
    });
    vi.mocked(providers.getById).mockReturnValue(
      provider({
        poll: vi.fn().mockResolvedValue({ status: 'pending' } as PollResult),
      }),
    );

    await expect(advance(job, db)).resolves.toBe('advanced');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      phase: 'polling',
      status: 'running',
      pollLeaseUntil: null,
    });
  });

  it('persists a retryable poll failure and clears it after the next successful poll', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      const job = seedJob(db, {
        phase: 'polling',
        providerHandle: JSON.stringify({
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'retry-request',
          statusUrl: 'https://status.example.test/retry-request',
          responseUrl: 'https://response.example.test/retry-request',
          cancelUrl: null,
          submittedAt: now,
        }),
      });
      const poll = vi
        .fn()
        .mockResolvedValueOnce({
          status: 'failed',
          error: {
            code: 'TIMEOUT',
            message:
              'temporary outage prompt=private https://signed.example/image?token=secret',
            retryable: true,
            disposition: 'rejected',
            retryAfterMs: 5_000,
          },
        } as PollResult)
        .mockResolvedValueOnce({ status: 'running' } as PollResult);
      vi.mocked(providers.getById).mockReturnValue(provider({ poll }));

      await expect(advance(job, db)).resolves.toBe('retried');
      const scheduled = getGenerationJob(job.id, db)!;
      expect(scheduled).toMatchObject({
        status: 'pending',
        phase: 'polling',
        pollLeaseUntil: null,
        attemptCount: 1,
        retryStartedAt: '2026-07-20T00:00:00.000Z',
        nextPollAt: '2026-07-20T00:00:05.000Z',
        error: expect.stringContaining('TIMEOUT'),
      });
      expect(scheduled.error).not.toContain('prompt=private');
      expect(scheduled.error).not.toContain('signed.example');

      await expect(advance(scheduled, db)).resolves.toBe('skipped');
      expect(poll).toHaveBeenCalledOnce();

      vi.setSystemTime(new Date(scheduled.nextPollAt!));
      await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe(
        'advanced',
      );
      expect(getGenerationJob(job.id, db)).toMatchObject({
        status: 'running',
        phase: 'polling',
        error: null,
        attemptCount: 0,
        retryStartedAt: null,
        nextPollAt: '2026-07-20T00:00:10.000Z',
      });
      expect(poll).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('retries a thrown poll exception without replaying dispatch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      const job = seedJob(db, {
        phase: 'polling',
        providerHandle: JSON.stringify({
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'retry-throw',
          statusUrl: 'https://status.example.test/retry-throw',
          responseUrl: 'https://response.example.test/retry-throw',
          cancelUrl: null,
          submittedAt: now,
        }),
      });
      vi.mocked(providers.getById).mockReturnValue(
        provider({
          poll: vi.fn().mockRejectedValue(new Error('socket reset')),
        }),
      );

      await expect(advance(job, db)).resolves.toBe('retried');
      expect(getGenerationJob(job.id, db)).toMatchObject({
        phase: 'polling',
        status: 'pending',
        attemptCount: 1,
        error: expect.stringContaining('PROVIDER_ERROR'),
      });
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('turns a malformed poll result into a bounded retry checkpoint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      const job = seedJob(db, {
        phase: 'polling',
        providerHandle: JSON.stringify({
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'malformed-poll',
          statusUrl: 'https://status.example.test/malformed-poll',
          responseUrl: 'https://response.example.test/malformed-poll',
          cancelUrl: null,
          submittedAt: now,
        }),
      });
      vi.mocked(providers.getById).mockReturnValue(
        provider({ poll: vi.fn().mockResolvedValue(undefined) }),
      );

      await expect(advance(job, db)).resolves.toBe('retried');
      expect(getGenerationJob(job.id, db)).toMatchObject({
        status: 'pending',
        phase: 'polling',
        pollLeaseUntil: null,
        attemptCount: 1,
        retryStartedAt: '2026-07-20T00:00:00.000Z',
        nextPollAt: '2026-07-20T00:00:00.250Z',
        error: expect.stringContaining('PROVIDER_ERROR'),
      });
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('safely snapshots a completed result whose images getter throws', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      const job = seedJob(db, {
        phase: 'polling',
        providerHandle: JSON.stringify({
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'getter-poll',
          statusUrl: 'https://status.example.test/getter-poll',
          responseUrl: 'https://response.example.test/getter-poll',
          cancelUrl: null,
          submittedAt: now,
        }),
      });
      const malformedResult = {
        status: 'completed',
        get images() {
          throw new Error('provider images getter failed');
        },
      };
      vi.mocked(providers.getById).mockReturnValue(
        provider({ poll: vi.fn().mockResolvedValue(malformedResult) }),
      );

      await expect(advance(job, db)).resolves.toBe('retried');
      expect(getGenerationJob(job.id, db)).toMatchObject({
        status: 'pending',
        phase: 'polling',
        pollLeaseUntil: null,
        attemptCount: 1,
        retryStartedAt: '2026-07-20T00:00:00.000Z',
        nextPollAt: '2026-07-20T00:00:00.250Z',
        error: expect.stringContaining('PROVIDER_ERROR'),
      });
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops after the sixth retryable poll failure without scheduling a seventh call', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    try {
      const { db } = createTestDb();
      const job = seedJob(db, {
        phase: 'polling',
        attemptCount: 5,
        retryStartedAt: '2026-07-20T00:00:00.000Z',
        providerHandle: JSON.stringify({
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'retry-exhausted',
          statusUrl: 'https://status.example.test/retry-exhausted',
          responseUrl: 'https://response.example.test/retry-exhausted',
          cancelUrl: null,
          submittedAt: now,
        }),
      });
      const poll = vi.fn().mockResolvedValue({
        status: 'failed',
        error: { code: 'TIMEOUT', message: 'still down', retryable: true },
      } as PollResult);
      vi.mocked(providers.getById).mockReturnValue(provider({ poll }));

      await expect(advance(job, db)).resolves.toBe('failed');
      expect(getGenerationJob(job.id, db)).toMatchObject({
        status: 'failed',
        phase: 'terminal',
        error: expect.stringContaining('RETRY_EXHAUSTED'),
        nextPollAt: null,
        pollLeaseUntil: null,
        attemptCount: 0,
        retryStartedAt: null,
      });
      await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe(
        'skipped',
      );
      expect(poll).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists result refs and stores one missing image per lease', async () => {
    const { db } = createTestDb();
    const job = seedJob(db, {
      phase: 'polling',
      attemptCount: 1,
      retryStartedAt: now,
      error: JSON.stringify({
        code: 'TIMEOUT',
        message: 'temporary',
        retryable: true,
      }),
      providerHandle: JSON.stringify({
        providerId: 'fal',
        model: 'fal-ai/flux/schnell',
        externalId: 'request-1',
        statusUrl: 'https://status.example.test/request-1',
        responseUrl: 'https://response.example.test/request-1',
        cancelUrl: null,
        submittedAt: now,
      }),
    });
    vi.mocked(providers.getById).mockReturnValue(
      provider({
        poll: vi.fn().mockResolvedValue({
          status: 'completed',
          images: [
            {
              url: 'https://cdn.example.test/0.png',
              width: 1,
              height: 1,
              contentType: 'image/png',
              index: 0,
            },
            {
              url: 'https://cdn.example.test/1.png',
              width: 1,
              height: 1,
              contentType: 'image/png',
              index: 1,
            },
          ],
        } as PollResult),
      }),
    );
    vi.mocked(storage.downloadAndStore)
      .mockResolvedValueOnce({
        storagePath: '0.png',
        contentType: 'image/png',
        sizeBytes: 1,
      })
      .mockResolvedValueOnce({
        storagePath: '1.png',
        contentType: 'image/png',
        sizeBytes: 1,
      });

    await expect(advance(job, db)).resolves.toBe('advanced');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      phase: 'storing',
      status: 'running',
      error: null,
      attemptCount: 0,
      retryStartedAt: null,
    });

    await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe(
      'advanced',
    );
    expect(getGenerationWithJobsAndImages('gen-1', db)!.images).toHaveLength(1);
    expect(storage.downloadAndStore).toHaveBeenCalledTimes(1);

    await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe(
      'completed',
    );
    expect(getGenerationWithJobsAndImages('gen-1', db)).toMatchObject({
      status: 'completed',
      images: expect.arrayContaining([expect.anything(), expect.anything()]),
    });
    expect(storage.downloadAndStore).toHaveBeenCalledTimes(2);
  });

  it('continues polling legacy handle rows that do not have a request snapshot', async () => {
    const { db } = createTestDb();
    const job = seedJob(db, {
      phase: 'polling',
      requestSnapshot: null,
      requestSnapshotVersion: null,
      providerHandle: JSON.stringify({
        providerId: 'fal',
        model: 'fal-ai/flux/schnell',
        externalId: 'legacy-request',
        statusUrl: 'https://status.example.test/legacy-request',
        responseUrl: 'https://response.example.test/legacy-request',
        cancelUrl: null,
        submittedAt: now,
      }),
    });
    vi.mocked(providers.getById).mockReturnValue(
      provider({
        poll: vi.fn().mockResolvedValue({
          status: 'completed',
          images: [
            {
              url: 'https://cdn.example.test/legacy.png',
              width: 1,
              height: 1,
              contentType: 'image/png',
              index: 0,
            },
          ],
        } as PollResult),
      }),
    );

    await expect(advance(job, db)).resolves.toBe('advanced');
    expect(getGenerationJob(job.id, db)?.phase).toBe('storing');
  });

  it('stages a data URL before persisting an opaque recoverable result snapshot', async () => {
    const { db } = createTestDb();
    const job = seedJob(db);
    const stagedReference = 'staging:11111111-1111-4111-8111-111111111111';
    vi.mocked(storage.stageInlineImage).mockReturnValue({
      reference: stagedReference,
      contentType: 'image/png',
      sizeBytes: 8,
    });
    vi.mocked(storage.downloadAndStore).mockResolvedValue({
      storagePath: '2026/07/staged.png',
      contentType: 'image/png',
      sizeBytes: 8,
    });
    vi.mocked(providers.getById).mockReturnValue(
      provider({
        submit: vi.fn().mockResolvedValue({
          kind: 'sync',
          images: [
            {
              url: 'data:image/png;base64,iVBORw0KGgo=',
              width: 1,
              height: 1,
              contentType: 'image/png',
              index: 0,
            },
          ],
        }),
      }),
    );

    await expect(advance(job, db)).resolves.toBe('advanced');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      phase: 'storing',
      status: 'running',
      resultSnapshot: expect.stringContaining(stagedReference),
    });
    expect(getGenerationJob(job.id, db)?.resultSnapshot).not.toContain(
      'data:image',
    );
    await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe(
      'completed',
    );
    expect(storage.downloadAndStore).toHaveBeenCalledWith(stagedReference);
    expect(storage.removeStagedImage).toHaveBeenCalledWith(stagedReference);
  });

  it('turns a malformed provider image result into a durable terminal failure', async () => {
    const { db } = createTestDb();
    const job = seedJob(db);
    vi.mocked(providers.getById).mockReturnValue(
      provider({
        submit: vi.fn().mockResolvedValue({
          kind: 'sync',
          images: [
            {
              url: 'https://cdn.example.test/bad.png',
              width: 1,
              height: 1,
              // Runtime adapter data is untrusted even though the TypeScript
              // type requires this field. It must not leave the job pending.
              contentType: undefined,
              index: 0,
            },
          ],
        }),
      }),
    );

    await expect(advance(job, db)).resolves.toBe('failed');
    expect(storage.downloadAndStore).not.toHaveBeenCalled();
    expect(getGenerationJob(job.id, db)).toMatchObject({
      status: 'failed',
      phase: 'terminal',
      error: expect.stringContaining('STORAGE_RESPONSE_INVALID'),
    });
  });

  it('cleans a downloaded image when cancellation wins during storage', async () => {
    const { db } = createTestDb();
    const stagedReference = 'staging:22222222-2222-4222-8222-222222222222';
    const job = seedJob(db, {
      phase: 'storing',
      status: 'running',
      resultSnapshot: JSON.stringify([
        {
          url: stagedReference,
          width: 1,
          height: 1,
          contentType: 'image/png',
          index: 0,
        },
      ]),
    });
    const download = deferred<{
      storagePath: string;
      contentType: string;
      sizeBytes: number;
    }>();
    vi.mocked(storage.downloadAndStore).mockReturnValue(download.promise);

    const storing = advance(job, db);
    await Promise.resolve();
    await cancelGeneration('gen-1', { db });
    download.resolve({
      storagePath: '2026/07/cancel-race.png',
      contentType: 'image/png',
      sizeBytes: 1,
    });

    await expect(storing).resolves.toBe('skipped');
    expect(getGenerationWithJobsAndImages('gen-1', db)).toMatchObject({
      images: [],
      jobs: [
        expect.objectContaining({ status: 'cancelled', resultSnapshot: null }),
      ],
    });
    expect(storage.removeStoredFile).toHaveBeenCalledWith(
      '2026/07/cancel-race.png',
    );
    expect(storage.removeStagedImage).toHaveBeenCalledWith(stagedReference);
  });
});
