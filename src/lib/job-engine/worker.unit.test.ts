import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb } from '../../../tests/helpers/db';
import { createGenerationAndJob, getGenerationJob } from '../db';
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

function seedQueuedJob(db: ReturnType<typeof createTestDb>['db']) {
  createGenerationAndJob(
    {
      id: 'gen-worker',
      sessionId: 'default-session',
      prompt: 'worker test',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'job-worker',
      generationId: 'gen-worker',
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
      images: [{ url: 'https://cdn.example.test/worker.png', width: 1, height: 1, contentType: 'image/png', index: 0 }],
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
});
