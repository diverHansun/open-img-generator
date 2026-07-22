import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../tests/helpers/db';
import { createGenerationAndJob, generationJobs, getGenerationJob } from '../db';
import type { ImageProvider } from '../providers';
import * as providers from '../providers';
import * as storage from '../storage';
import { createRequestSnapshot, REQUEST_SNAPSHOT_VERSION } from './request-snapshot';
import { runWorkerOnce } from './worker';

vi.mock('../providers', () => ({ getById: vi.fn() }));
vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
  downloadAndStore: vi.fn(),
}));

const now = '2026-07-12T10:00:00.000Z';

function seedQueuedJob(
  db: ReturnType<typeof createTestDb>['db'],
  suffix = 'worker',
) {
  createGenerationAndJob(
    {
      id: `gen-${suffix}`,
      sessionId: 'default-session',
      prompt: 'worker test',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `job-${suffix}`,
      generationId: `gen-${suffix}`,
      provider: 'fal',
      model: 'fal-ai/flux/schnell',
      status: 'pending',
      phase: 'queued',
      requestSnapshot: createRequestSnapshot({ prompt: 'worker test', count: 1 }),
      requestSnapshotVersion: REQUEST_SNAPSHOT_VERSION,
      nextPollAt: '2000-01-01T00:00:00.000Z',
      createdAt: now,
      updatedAt: now,
    },
    db,
  );
}

function seedPollingJob(db: ReturnType<typeof createTestDb>['db']) {
  seedQueuedJob(db);
  db.update(generationJobs).set({
    phase: 'polling',
    providerHandle: JSON.stringify({
      providerId: 'fal',
      model: 'fal-ai/flux/schnell',
      externalId: 'worker-retry',
      statusUrl: 'https://status.example.test/worker-retry',
      responseUrl: 'https://response.example.test/worker-retry',
      cancelUrl: null,
      submittedAt: now,
    }),
    nextPollAt: '2000-01-01T00:00:00.000Z',
  }).where(eq(generationJobs.id, 'job-worker')).run();
}

describe('job worker', () => {
  beforeEach(() => {
    vi.mocked(providers.getById).mockReset();
    vi.mocked(storage.downloadAndStore).mockReset();
  });

  it('advances queued work through durable dispatch and storage checkpoints', async () => {
    const { db } = createTestDb();
    seedQueuedJob(db);
    const submit = vi.fn().mockResolvedValue({
      kind: 'sync',
      images: [{ url: 'https://v3.fal.media/worker.png', width: 1, height: 1, contentType: 'image/png', index: 0 }],
    });
    const provider: ImageProvider = {
      id: 'fal',
      displayName: 'fal.ai',
      capabilities: new Map(),
      submit,
    };
    vi.mocked(providers.getById).mockReturnValue(provider);
    vi.mocked(storage.downloadAndStore).mockResolvedValue({
      storagePath: '2026/07/worker.png',
      contentType: 'image/png',
      sizeBytes: 4,
    });

    await expect(runWorkerOnce({ db, batchSize: 4 })).resolves.toMatchObject({
      scanned: 1,
      advanced: 1,
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(getGenerationJob('job-worker', db)).toMatchObject({ phase: 'storing', status: 'running' });

    await expect(runWorkerOnce({ db, batchSize: 4 })).resolves.toMatchObject({
      scanned: 1,
      completed: 1,
    });
    expect(getGenerationJob('job-worker', db)).toMatchObject({ phase: 'terminal', status: 'completed' });
  });

  it('drains more due jobs than one internal page without unbounded fan-out', async () => {
    const { db } = createTestDb();
    for (let index = 0; index < 5; index += 1) {
      seedQueuedJob(db, `worker-${index}`);
    }
    let activeSubmits = 0;
    let maxActiveSubmits = 0;
    const submit = vi.fn(async () => {
      activeSubmits += 1;
      maxActiveSubmits = Math.max(maxActiveSubmits, activeSubmits);
      await Promise.resolve();
      activeSubmits -= 1;
      return {
        kind: 'sync' as const,
        images: [{ url: 'https://v3.fal.media/page.png', width: 1, height: 1, contentType: 'image/png', index: 0 }],
      };
    });
    vi.mocked(providers.getById).mockReturnValue({
      id: 'fal',
      displayName: 'fal.ai',
      capabilities: new Map(),
      submit,
    });
    vi.mocked(storage.downloadAndStore).mockResolvedValue({
      storagePath: '2026/07/page.png',
      contentType: 'image/png',
      sizeBytes: 4,
    });

    await expect(runWorkerOnce({ db, batchSize: 2 })).resolves.toMatchObject({
      scanned: 5,
      advanced: 5,
      completed: 0,
    });
    await expect(runWorkerOnce({ db, batchSize: 2 })).resolves.toMatchObject({
      scanned: 5,
      completed: 5,
    });
    expect(submit).toHaveBeenCalledTimes(5);
    expect(maxActiveSubmits).toBe(2);
    for (let index = 0; index < 5; index += 1) {
      expect(getGenerationJob(`job-worker-${index}`, db)).toMatchObject({
        phase: 'terminal',
        status: 'completed',
      });
    }
  });

  it('returns zeroed domain counters when no jobs are due', async () => {
    const { db } = createTestDb();
    await expect(runWorkerOnce({ db })).resolves.toEqual({
      scanned: 0,
      advanced: 0,
      retried: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
      cancelled: 0,
      skipped: 0,
    });
  });

  it('counts a durable retry once and does not call the provider before its due time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { db } = createTestDb();
      seedPollingJob(db);
      const poll = vi.fn().mockResolvedValue({
        status: 'failed',
        error: { code: 'TIMEOUT', message: 'temporary outage', retryable: true },
      });
      vi.mocked(providers.getById).mockReturnValue({
        id: 'fal',
        displayName: 'fal.ai',
        capabilities: new Map(),
        submit: vi.fn(),
        poll,
      } as ImageProvider);

      await expect(runWorkerOnce({ db, batchSize: 4 })).resolves.toEqual({
        scanned: 1,
        advanced: 0,
        retried: 1,
        completed: 0,
        failed: 0,
        unknown: 0,
        cancelled: 0,
        skipped: 0,
      });
      await expect(runWorkerOnce({ db, batchSize: 4 })).resolves.toEqual({
        scanned: 0,
        advanced: 0,
        retried: 0,
        completed: 0,
        failed: 0,
        unknown: 0,
        cancelled: 0,
        skipped: 0,
      });
      expect(poll).toHaveBeenCalledOnce();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });
});
