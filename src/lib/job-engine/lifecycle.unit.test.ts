import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../../../tests/helpers/db';
import { createGenerationAndJob, getGenerationWithJobsAndImages } from '../db/queries/generations';
import { storeImages, completeSync, advance } from './lifecycle';
import type { ProviderImageRef, PollResult } from '../providers';

vi.mock('../storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../storage')>();
  return {
    ...original,
    downloadAndStore: vi.fn(),
  };
});

vi.mock('../providers', async () => {
  return {
    getById: vi.fn(),
  };
});

import * as storage from '../storage';
import * as providers from '../providers';

const now = '2026-07-12T10:00:00.000Z';

function seedGeneration(db: ReturnType<typeof createTestDb>['db'], handle?: object) {
  const { job } = createGenerationAndJob(
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
      createdAt: now,
      updatedAt: now,
    },
    db,
  );
  if (handle) {
    db.update(generationJobs)
      .set({ providerHandle: JSON.stringify(handle) })
      .where(eq(generationJobs.id, job.id))
      .run();
  }
  return job;
}

import { generationJobs } from '../db';
import { eq } from 'drizzle-orm';

describe('lifecycle', () => {
  beforeEach(() => {
    vi.mocked(storage.downloadAndStore).mockReset();
    vi.mocked(providers.getById).mockReset();
  });

  describe('storeImages', () => {
    it('downloads and creates image records', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db);
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });

      const images: ProviderImageRef[] = [
        { url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 },
      ];
      const result = await storeImages(job.id, images, db);

      expect(result.kind).toBe('ok');
      const gen = getGenerationWithJobsAndImages('gen-1', db);
      expect(gen!.images).toHaveLength(1);
    });

    it('skips already stored images', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db);
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });

      const images: ProviderImageRef[] = [
        { url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 },
      ];
      await storeImages(job.id, images, db);
      const result = await storeImages(job.id, images, db);

      expect(result.kind).toBe('ok');
      expect(storage.downloadAndStore).toHaveBeenCalledTimes(1);
    });

    it('returns failed on storage error and keeps previous images', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db);
      vi.mocked(storage.downloadAndStore)
        .mockResolvedValueOnce({ storagePath: '2026/07/1.png', contentType: 'image/png', sizeBytes: 1 })
        .mockRejectedValueOnce(new Error('network down'));

      const images: ProviderImageRef[] = [
        { url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 },
        { url: 'https://cdn.example.com/2.png', width: 1024, height: 1024, contentType: 'image/png', index: 1 },
      ];
      const result = await storeImages(job.id, images, db);

      expect(result.kind).toBe('failed');
      const gen = getGenerationWithJobsAndImages('gen-1', db);
      expect(gen!.images).toHaveLength(1);
    });
  });

  describe('completeSync', () => {
    it('marks job and generation completed after storing images', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db);
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });

      await completeSync('gen-1', job.id, [
        { url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 },
      ], db);

      const gen = getGenerationWithJobsAndImages('gen-1', db);
      expect(gen!.status).toBe('completed');
      expect(gen!.jobs[0].status).toBe('completed');
    });
  });

  describe('advance', () => {
    it('skips when job is already terminal', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db, { providerId: 'fal', model: 'fal-ai/flux/schnell', externalId: 'r1' });
      // Simulate another request already advanced the job to completed.
      db.update(generationJobs).set({ status: 'completed' }).where(eq(generationJobs.id, job.id)).run();

      const poll = vi.fn();
      vi.mocked(providers.getById).mockReturnValue({ id: 'fal', poll } as unknown as ReturnType<typeof providers.getById>);

      await advance({ ...job, status: 'pending' }, db);
      expect(poll).not.toHaveBeenCalled();
    });

    it('polls a running job without overwriting its real status to claim a lock', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db, { providerId: 'fal', model: 'fal-ai/flux/schnell', externalId: 'r1' });
      db.update(generationJobs).set({ status: 'running' }).where(eq(generationJobs.id, job.id)).run();

      const poll = vi.fn().mockResolvedValue({ status: 'pending' } as PollResult);
      vi.mocked(providers.getById).mockReturnValue({
        id: 'fal',
        poll,
      } as unknown as ReturnType<typeof providers.getById>);

      await advance({ ...job, status: 'running' }, db);

      expect(poll).toHaveBeenCalledTimes(1);
      const stored = getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]!;
      expect(stored.status).toBe('pending');
      expect(stored.pollLeaseUntil).toBeNull();
    });

    it('allows only one concurrent poll while a lease is active', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db, { providerId: 'fal', model: 'fal-ai/flux/schnell', externalId: 'r1' });
      let finishPoll!: (result: PollResult) => void;
      const poll = vi.fn().mockImplementation(
        () => new Promise<PollResult>((resolve) => { finishPoll = resolve; }),
      );
      vi.mocked(providers.getById).mockReturnValue({
        id: 'fal',
        poll,
      } as unknown as ReturnType<typeof providers.getById>);

      const first = advance(job, db);
      const second = advance(job, db);
      await Promise.resolve();
      expect(poll).toHaveBeenCalledTimes(1);

      finishPoll({ status: 'pending' });
      await Promise.all([first, second]);
      expect(getGenerationWithJobsAndImages('gen-1', db)!.jobs[0]!.pollLeaseUntil).toBeNull();
    });

    it('polls completed and stores images', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db, { providerId: 'fal', model: 'fal-ai/flux/schnell', externalId: 'r1' });
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });

      const pollResult: PollResult = {
        status: 'completed',
        images: [{ url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 }],
      };
      vi.mocked(providers.getById).mockReturnValue({
        id: 'fal',
        poll: vi.fn().mockResolvedValue(pollResult),
      } as unknown as ReturnType<typeof providers.getById>);

      await advance(job, db);

      const gen = getGenerationWithJobsAndImages('gen-1', db);
      expect(gen!.status).toBe('completed');
    });

    it('marks failed when poll returns failed', async () => {
      const { db } = createTestDb();
      const job = seedGeneration(db, { providerId: 'fal', model: 'fal-ai/flux/schnell', externalId: 'r1' });

      vi.mocked(providers.getById).mockReturnValue({
        id: 'fal',
        poll: vi.fn().mockResolvedValue({
          status: 'failed',
          error: { code: 'PROVIDER_ERROR', message: 'boom', retryable: false },
        }),
      } as unknown as ReturnType<typeof providers.getById>);

      await advance(job, db);

      const gen = getGenerationWithJobsAndImages('gen-1', db);
      expect(gen!.status).toBe('failed');
      expect(gen!.jobs[0].status).toBe('failed');
    });
  });
});
