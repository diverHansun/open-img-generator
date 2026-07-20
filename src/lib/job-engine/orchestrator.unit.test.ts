import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../tests/helpers/db';
import { generations, getGenerationWithJobsAndImages, sessions } from '../db';
import { IdempotencyKeyReusedError } from '../errors';
import type { ImageProvider } from '../providers';
import * as providers from '../providers';
import * as storage from '../storage';
import { getGeneration, submitGeneration } from './orchestrator';

vi.mock('../providers', () => ({ getById: vi.fn() }));
vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
  downloadAndStore: vi.fn(),
}));

const clientRequestId = '15a6fecc-4f40-4ed2-8f51-353423be9af1';

function makeProvider(overrides: Partial<ImageProvider> = {}): ImageProvider {
  return {
    id: 'fal',
    displayName: 'fal.ai',
    capabilities: new Map([
      [
        'fal-ai/flux/schnell',
        {
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          displayName: 'FLUX Schnell',
          modes: ['text-to-image'],
          maxCount: 4,
          supportedSizes: ['square_hd'],
          supportedAspectRatios: ['1:1'],
          supportsNegativePrompt: false,
          supportsSeed: true,
          protocol: 'async',
          defaultSize: 'square_hd',
        },
      ],
    ]),
    submit: vi.fn(),
    ...overrides,
  } as ImageProvider;
}

function params(overrides: Partial<Parameters<typeof submitGeneration>[0]> = {}) {
  return {
    clientRequestId,
    prompt: 'A quiet reading room',
    sessionId: 'default-session',
    targets: [{ provider: 'fal' as const, model: 'fal-ai/flux/schnell' }],
    ...overrides,
  };
}

describe('generation orchestrator durable admission', () => {
  let db: ReturnType<typeof createTestDb>['db'];

  beforeEach(() => {
    db = createTestDb().db;
    process.env.FAL_KEY = 'test-fal-key';
    vi.mocked(providers.getById).mockReset();
    vi.mocked(storage.downloadAndStore).mockReset();
  });

  afterEach(() => {
    delete process.env.FAL_KEY;
  });

  it('commits a queued job with a recoverable snapshot before any provider call', async () => {
    const submit = vi.fn();
    vi.mocked(providers.getById).mockReturnValue(makeProvider({ submit }));

    const result = await submitGeneration(
      params({ seed: 42, aspectRatio: '1:1' }),
      { db },
    );

    expect(result).toMatchObject({ status: 'pending', replayed: false });
    expect(submit).not.toHaveBeenCalled();
    const stored = getGenerationWithJobsAndImages(result.generationId, db)!;
    expect(stored.jobs[0]).toMatchObject({
      status: 'pending',
      phase: 'queued',
      requestSnapshotVersion: 1,
      attemptCount: 0,
    });
    expect(stored.jobs[0]!.requestSnapshot).toContain('"seed":42');
    expect(stored.jobs[0]!.requestSnapshot).not.toContain('clientRequestId');
  });

  it('replays the same durable generation without revalidating current provider configuration', async () => {
    vi.mocked(providers.getById).mockReturnValue(makeProvider());
    const first = await submitGeneration(params(), { db });
    vi.mocked(providers.getById).mockReturnValue(undefined);

    await expect(submitGeneration(params(), { db })).resolves.toEqual({
      generationId: first.generationId,
      status: 'pending',
      replayed: true,
    });
    expect(db.select().from(generations).all()).toHaveLength(1);
  });

  it('rejects a reused key that describes different input without creating work', async () => {
    vi.mocked(providers.getById).mockReturnValue(makeProvider());
    await submitGeneration(params(), { db });

    await expect(
      submitGeneration(params({ prompt: 'A different room' }), { db }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(db.select().from(generations).all()).toHaveLength(1);
  });

  it('touches the session in the same durable admission transaction', async () => {
    vi.mocked(providers.getById).mockReturnValue(makeProvider());
    const before = db
      .select({ updatedAt: sessions.updatedAt })
      .from(sessions)
      .where(eq(sessions.id, 'default-session'))
      .get()!.updatedAt;

    await submitGeneration(params(), { db });

    expect(
      db
        .select({ updatedAt: sessions.updatedAt })
        .from(sessions)
        .where(eq(sessions.id, 'default-session'))
        .get()!.updatedAt,
    ).not.toBe(before);
  });

  it('advances a sync target across dispatch and storing checkpoints', async () => {
    const submit = vi.fn().mockResolvedValue({
      kind: 'sync',
      images: [
        {
          url: 'https://cdn.example.test/reading-room.png',
          width: 1024,
          height: 1024,
          contentType: 'image/png',
          index: 0,
        },
      ],
    });
    vi.mocked(providers.getById).mockReturnValue(makeProvider({ submit }));
    vi.mocked(storage.downloadAndStore).mockResolvedValue({
      storagePath: '2026/07/reading-room.png',
      contentType: 'image/png',
      sizeBytes: 42,
    });

    const admitted = await submitGeneration(params(), { db });
    const afterDispatch = await getGeneration(admitted.generationId, { db });
    expect(submit).toHaveBeenCalledOnce();
    expect(afterDispatch.status).toBe('running');
    expect(getGenerationWithJobsAndImages(admitted.generationId, db)!.jobs[0]).toMatchObject({
      phase: 'storing',
      resultSnapshot: expect.any(String),
    });

    const completed = await getGeneration(admitted.generationId, { db });
    expect(completed.status).toBe('completed');
    expect(completed.images).toHaveLength(1);
  });
});
