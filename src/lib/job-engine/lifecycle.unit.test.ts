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
import type { ImageProvider, PollResult } from '../providers';
import * as providers from '../providers';
import * as storage from '../storage';
import { createRequestSnapshot, REQUEST_SNAPSHOT_VERSION } from './request-snapshot';
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
    db.update(generationJobs).set(patch).where(eq(generationJobs.id, 'job-1')).run();
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

    const [first, second] = await Promise.all([advance(job, db), advance(job, db)]);

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
      provider({ submit: vi.fn().mockRejectedValue(new Error('connection reset')) }),
    );

    await expect(advance(job, db)).resolves.toBe('unknown');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      status: 'failed',
      phase: 'outcome_unknown',
      requestSnapshot: null,
      requestSnapshotVersion: null,
      resultSnapshot: null,
    });
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
      provider({ poll: vi.fn().mockResolvedValue({ status: 'pending' } as PollResult) }),
    );

    await expect(advance(job, db)).resolves.toBe('advanced');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      phase: 'polling',
      status: 'running',
      pollLeaseUntil: null,
    });
  });

  it('persists result refs and stores one missing image per lease', async () => {
    const { db } = createTestDb();
    const job = seedJob(db, {
      phase: 'polling',
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
            { url: 'https://cdn.example.test/0.png', width: 1, height: 1, contentType: 'image/png', index: 0 },
            { url: 'https://cdn.example.test/1.png', width: 1, height: 1, contentType: 'image/png', index: 1 },
          ],
        } as PollResult),
      }),
    );
    vi.mocked(storage.downloadAndStore)
      .mockResolvedValueOnce({ storagePath: '0.png', contentType: 'image/png', sizeBytes: 1 })
      .mockResolvedValueOnce({ storagePath: '1.png', contentType: 'image/png', sizeBytes: 1 });

    await expect(advance(job, db)).resolves.toBe('advanced');
    expect(getGenerationJob(job.id, db)).toMatchObject({ phase: 'storing', status: 'running' });

    await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe('advanced');
    expect(getGenerationWithJobsAndImages('gen-1', db)!.images).toHaveLength(1);
    expect(storage.downloadAndStore).toHaveBeenCalledTimes(1);

    await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe('completed');
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
          images: [{ url: 'https://cdn.example.test/legacy.png', width: 1, height: 1, contentType: 'image/png', index: 0 }],
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
          images: [{
            url: 'data:image/png;base64,iVBORw0KGgo=',
            width: 1,
            height: 1,
            contentType: 'image/png',
            index: 0,
          }],
        }),
      }),
    );

    await expect(advance(job, db)).resolves.toBe('advanced');
    expect(getGenerationJob(job.id, db)).toMatchObject({
      phase: 'storing',
      status: 'running',
      resultSnapshot: expect.stringContaining(stagedReference),
    });
    expect(getGenerationJob(job.id, db)?.resultSnapshot).not.toContain('data:image');
    await expect(advance(getGenerationJob(job.id, db)!, db)).resolves.toBe('completed');
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
          images: [{
            url: 'https://cdn.example.test/bad.png',
            width: 1,
            height: 1,
            // Runtime adapter data is untrusted even though the TypeScript
            // type requires this field. It must not leave the job pending.
            contentType: undefined,
            index: 0,
          }],
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
      resultSnapshot: JSON.stringify([{
        url: stagedReference,
        width: 1,
        height: 1,
        contentType: 'image/png',
        index: 0,
      }]),
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
      jobs: [expect.objectContaining({ status: 'cancelled', resultSnapshot: null })],
    });
    expect(storage.removeStoredFile).toHaveBeenCalledWith('2026/07/cancel-race.png');
    expect(storage.removeStagedImage).toHaveBeenCalledWith(stagedReference);
  });
});
