import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../../tests/helpers/db';
import { createGenerationAndJob, getGenerationJob, updateGenerationJob } from '../db';
import type { ImageProvider } from '../providers';
import * as providers from '../providers';
import * as storage from '../storage';
import { runWorkerOnce } from './worker';

vi.mock('../providers', () => ({ getById: vi.fn() }));
vi.mock('../storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../storage')>();
  return { ...original, downloadAndStore: vi.fn() };
});

describe('job worker', () => {
  beforeEach(() => {
    vi.mocked(providers.getById).mockReset();
    vi.mocked(storage.downloadAndStore).mockReset();
  });

  it('claims due jobs, polls them, and stores completed images', async () => {
    const { db } = createTestDb();
    const now = '2026-07-12T10:00:00.000Z';
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
        createdAt: now,
        updatedAt: now,
      },
      db,
    );
    updateGenerationJob(
      'job-worker',
      {
        status: 'pending',
        providerHandle: JSON.stringify({
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'worker-task',
          statusUrl: 'https://status.example.test/worker-task',
          responseUrl: 'https://response.example.test/worker-task',
          cancelUrl: null,
          submittedAt: now,
        }),
        updatedAt: now,
      },
      db,
    );
    const provider: ImageProvider = {
      id: 'fal',
      displayName: 'fal.ai',
      capabilities: new Map(),
      submit: vi.fn(),
      poll: vi.fn().mockResolvedValue({
        status: 'completed',
        images: [{ url: 'data:image/png;base64,ZmFrZQ==', width: 1, height: 1, contentType: 'image/png', index: 0 }],
      }),
    };
    vi.mocked(providers.getById).mockReturnValue(provider);
    vi.mocked(storage.downloadAndStore).mockResolvedValue({
      storagePath: '2026/07/worker.png',
      contentType: 'image/png',
      sizeBytes: 4,
    });

    const result = await runWorkerOnce({ db, batchSize: 4 });

    expect(result).toEqual({ scanned: 1, succeeded: 1, failed: 0 });
    expect(getGenerationJob('job-worker', db)?.status).toBe('completed');
    expect(provider.poll).toHaveBeenCalledOnce();
  });

  it('returns an empty result when no jobs are due', async () => {
    const { db } = createTestDb();
    await expect(runWorkerOnce({ db })).resolves.toEqual({ scanned: 0, succeeded: 0, failed: 0 });
  });
});
