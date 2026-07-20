import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../../tests/helpers/db';
import {
  createGenerationAndJob,
  createImage,
  favorites,
  generations,
  getGenerationJob,
  getGenerationWithJobsAndImages,
  requestGenerationJobCancellation,
  updateGenerationJob,
} from '../db';
import type { ImageProvider } from '../providers';
import * as providers from '../providers';
import { cancelGeneration, submitGeneration } from './orchestrator';

vi.mock('../providers', () => ({ getById: vi.fn() }));

const now = '2026-07-12T10:00:00.000Z';

function seedAsyncJob(db: ReturnType<typeof createTestDb>['db']) {
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
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    db,
  );
  updateGenerationJob(
    'job-cancel',
    {
      status: 'pending',
      providerHandle: JSON.stringify({
        providerId: 'kling',
        model: 'kling-v3',
        externalId: 'kling-task',
        statusUrl: 'https://status.example.test/kling-task',
        responseUrl: 'https://status.example.test/kling-task',
        cancelUrl: null,
        submittedAt: now,
      }),
      updatedAt: now,
    },
    db,
  );
}

describe('cancelGeneration', () => {
  beforeEach(() => vi.mocked(providers.getById).mockReset());

  it('marks a Kling task cancelled locally when remote cancel is unsupported', async () => {
    const { db } = createTestDb();
    seedAsyncJob(db);
    const provider: ImageProvider = {
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit: vi.fn(),
      poll: vi.fn(),
    };
    vi.mocked(providers.getById).mockReturnValue(provider);
    createImage(
      {
        id: 'image-cancel',
        jobId: 'job-cancel',
        index: 0,
        storagePath: 'cancel.png',
        contentType: 'image/png',
        width: 1,
        height: 1,
        sizeBytes: 1,
        createdAt: now,
      },
      db,
    );
    db.insert(favorites)
      .values({ id: 'favorite-cancel', imageId: 'image-cancel', createdAt: now })
      .run();

    const view = await cancelGeneration('gen-cancel', { db });

    expect(view.status).toBe('cancelled');
    expect(view.jobs[0]?.status).toBe('cancelled');
    expect(view.jobs[0]?.error?.code).toBe('CANCEL_UNSUPPORTED');
    expect(view.images).toEqual([
      expect.objectContaining({ id: 'image-cancel', favorited: true }),
    ]);
    expect(getGenerationJob('job-cancel', db)?.cancelRequestedAt).toBeTruthy();
  });

  it('calls a provider cancel endpoint before marking the job cancelled', async () => {
    const { db } = createTestDb();
    seedAsyncJob(db);
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' });
    const provider: ImageProvider = {
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit: vi.fn(),
      poll: vi.fn(),
      cancel,
    };
    vi.mocked(providers.getById).mockReturnValue(provider);

    const view = await cancelGeneration('gen-cancel', { db });

    expect(cancel).toHaveBeenCalledOnce();
    expect(view.status).toBe('cancelled');
    expect(view.jobs[0]?.error).toBeUndefined();
  });

  it('does not let a late async submit resurrect a cancelled job', async () => {
    const { db } = createTestDb();
    let resolveSubmit!: (value: { kind: 'async'; handle: Record<string, unknown> }) => void;
    const provider: ImageProvider = {
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map([
        ['kling-v3', {
          providerId: 'kling',
          model: 'kling-v3',
          displayName: 'Kling Image V3',
          modes: ['text-to-image'],
          maxCount: 9,
          supportedSizes: ['1k'],
          supportedAspectRatios: ['1:1'],
          supportsNegativePrompt: true,
          supportsSeed: false,
          protocol: 'async',
          defaultSize: '1k',
        }],
      ]),
      submit: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; })),
      poll: vi.fn(),
    };
    vi.mocked(providers.getById).mockReturnValue(provider);

    const submitting = submitGeneration(
      {
        prompt: 'race test',
        sessionId: 'default-session',
        targets: [{ provider: 'kling', model: 'kling-v3' }],
        aspectRatio: '1:1',
      },
      { db },
    );
    await Promise.resolve();
    const generationId = db.select().from(generations).get()!.id;
    await cancelGeneration(generationId, { db });
    resolveSubmit({
      kind: 'async',
      handle: {
        providerId: 'kling',
        model: 'kling-v3',
        externalId: 'late-task',
        statusUrl: 'https://status.example.test/late-task',
        responseUrl: 'https://status.example.test/late-task',
        cancelUrl: null,
        submittedAt: now,
      },
    });

    await expect(submitting).resolves.toMatchObject({ generationId, status: 'cancelled' });
    expect(getGenerationWithJobsAndImages(generationId, db)?.jobs[0]?.status).toBe('cancelled');
  });

  it('does not let a sync completion overwrite a cancellation requested during image storage', async () => {
    const { db } = createTestDb();
    seedAsyncJob(db);
    const provider: ImageProvider = {
      id: 'kling',
      displayName: 'Kling AI',
      capabilities: new Map(),
      submit: vi.fn(),
      poll: vi.fn(),
    };
    vi.mocked(providers.getById).mockReturnValue(provider);

    // The orchestration path calls completeSync for sync providers; emulate
    // its storage phase by marking the job pending and invoking cancellation
    // while the download promise is still unresolved.
    let finishDownload!: () => void;
    const storageModule = await import('../storage');
    vi.spyOn(storageModule, 'downloadAndStore').mockImplementationOnce(
      () => new Promise((resolve) => {
        finishDownload = () => resolve({
          storagePath: '2026/07/cancel-race.png',
          contentType: 'image/png',
          sizeBytes: 1,
        });
      }),
    );

    const { completeSync } = await import('./lifecycle');
    const completion = completeSync('gen-cancel', 'job-cancel', [
      { url: 'https://cdn.example.test/race.png', width: 1, height: 1, contentType: 'image/png', index: 0 },
    ], db);
    await Promise.resolve();
    expect(requestGenerationJobCancellation('job-cancel', new Date().toISOString(), db)).toBe(true);
    finishDownload();
    await completion;

    expect(getGenerationJob('job-cancel', db)?.status).toBe('pending');
    expect(getGenerationWithJobsAndImages('gen-cancel', db)?.status).toBe('pending');
  });
});
