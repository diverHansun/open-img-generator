import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../../tests/helpers/db';
import { createSession } from '../db/queries/sessions';
import {
  favorites,
  generations,
  sessions,
  getGenerationWithJobsAndImages,
} from '../db';
import { submitGeneration, getGeneration } from './orchestrator';
import { IdempotencyKeyReusedError } from '../errors';
import * as providers from '../providers';
import * as storage from '../storage';
import type { ImageProvider, SubmitResult as ProviderSubmitResult, PollResult } from '../providers';

vi.mock('../providers', async () => {
  return {
    getById: vi.fn(),
  };
});

vi.mock('../storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../storage')>();
  return {
    ...original,
    downloadAndStore: vi.fn(),
  };
});

const now = '2026-07-12T10:00:00.000Z';

describe('orchestrator', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = createTestDb().db;
    process.env.FAL_KEY = 'test-fal-key';
    process.env.ZENMUX_API_KEY = 'test-zenmux-key';
    vi.mocked(providers.getById).mockReset();
    vi.mocked(storage.downloadAndStore).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function makeProvider(config: Partial<ImageProvider> & { submit: ImageProvider['submit'] }): ImageProvider {
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
      ...config,
    } as ImageProvider;
  }

  function makeParams(
    overrides: Partial<Parameters<typeof submitGeneration>[0]> = {},
  ): Parameters<typeof submitGeneration>[0] {
    return {
      clientRequestId: '15a6fecc-4f40-4ed2-8f51-353423be9af1',
      targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
      prompt: 'A cat',
      sessionId: 'default-session',
      ...overrides,
    };
  }

  describe('submitGeneration', () => {
    it('replays an admitted request without a second provider dispatch', async () => {
      const submit = vi.fn().mockResolvedValue({
        kind: 'failed',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'first attempt failed',
          retryable: false,
        },
      } as ProviderSubmitResult);
      vi.mocked(providers.getById).mockReturnValue(makeProvider({ submit }));

      const first = await submitGeneration(makeParams(), { db });
      const replay = await submitGeneration(makeParams(), { db });

      expect(first.replayed).toBe(false);
      expect(replay).toEqual({
        generationId: first.generationId,
        status: 'failed',
        replayed: true,
      });
      expect(submit).toHaveBeenCalledOnce();
      expect(db.select().from(generations).all()).toHaveLength(1);
    });

    it('replays a durable request even when its provider is no longer enabled', async () => {
      const submit = vi.fn().mockResolvedValue({
        kind: 'failed',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'first attempt failed',
          retryable: false,
        },
      } as ProviderSubmitResult);
      vi.mocked(providers.getById).mockReturnValue(makeProvider({ submit }));

      const first = await submitGeneration(makeParams(), { db });
      vi.mocked(providers.getById).mockReturnValue(undefined);

      await expect(submitGeneration(makeParams(), { db })).resolves.toEqual({
        generationId: first.generationId,
        status: 'failed',
        replayed: true,
      });
      expect(submit).toHaveBeenCalledOnce();
    });

    it('rejects a reused intent key when the canonical payload changed', async () => {
      const submit = vi.fn().mockResolvedValue({
        kind: 'failed',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'first attempt failed',
          retryable: false,
        },
      } as ProviderSubmitResult);
      vi.mocked(providers.getById).mockReturnValue(makeProvider({ submit }));

      await submitGeneration(makeParams(), { db });
      await expect(
        submitGeneration(makeParams({ prompt: 'A different cat' }), { db }),
      ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

      expect(submit).toHaveBeenCalledOnce();
      expect(db.select().from(generations).all()).toHaveLength(1);
    });

    it('admits concurrent equivalent calls only once', async () => {
      const submit = vi.fn().mockResolvedValue({
        kind: 'failed',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'first attempt failed',
          retryable: false,
        },
      } as ProviderSubmitResult);
      vi.mocked(providers.getById).mockReturnValue(makeProvider({ submit }));

      const [first, replay] = await Promise.all([
        submitGeneration(makeParams(), { db }),
        submitGeneration(makeParams(), { db }),
      ]);

      expect(first.generationId).toBe(replay.generationId);
      expect([first.replayed, replay.replayed].sort()).toEqual([false, true]);
      expect(submit).toHaveBeenCalledOnce();
    });

    it('returns pending for async provider', async () => {
      vi.mocked(providers.getById).mockReturnValue(
        makeProvider({
          submit: vi.fn().mockResolvedValue({
            kind: 'async',
            handle: {
              providerId: 'fal',
              model: 'fal-ai/flux/schnell',
              externalId: 'req-1',
              statusUrl: 'https://status',
              responseUrl: 'https://response',
              cancelUrl: null,
              submittedAt: now,
            },
          }),
        }),
      );

      const result = await submitGeneration(
        makeParams(),
        { db },
      );

      expect(result.status).toBe('pending');
    });

    it('returns completed for sync provider after storing images', async () => {
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });

      vi.mocked(providers.getById).mockReturnValue(
        makeProvider({
          id: 'zenmux',
          submit: vi.fn().mockResolvedValue({
            kind: 'sync',
            images: [{ url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 }],
          } as ProviderSubmitResult),
          capabilities: new Map([
            [
              'openai/gpt-image-2',
              {
                providerId: 'zenmux',
                model: 'openai/gpt-image-2',
                displayName: 'GPT Image 2',
                modes: ['text-to-image'],
                maxCount: 4,
                supportedSizes: ['1024x1024'],
                supportedAspectRatios: ['1:1'],
                supportsNegativePrompt: false,
                supportsSeed: false,
                protocol: 'sync',
                defaultSize: '1024x1024',
              },
            ],
          ]),
        }),
      );

      const result = await submitGeneration(
        makeParams({ targets: [{ provider: 'zenmux', model: 'openai/gpt-image-2' }] }),
        { db },
      );

      expect(result.status).toBe('completed');
    });

    it('returns failed when provider submit fails', async () => {
      vi.mocked(providers.getById).mockReturnValue(
        makeProvider({
          submit: vi.fn().mockResolvedValue({
            kind: 'failed',
            error: { code: 'AUTH_FAILED', message: 'bad key', retryable: false },
          }),
        }),
      );

      const result = await submitGeneration(
        makeParams(),
        { db },
      );

      expect(result.status).toBe('failed');
    });

    it('fans out targets independently and omits seed for unsupported models', async () => {
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });
      const falSubmit = vi.fn().mockResolvedValue({
        kind: 'async',
        handle: {
          providerId: 'fal',
          model: 'fal-ai/flux/schnell',
          externalId: 'req-1',
          statusUrl: 'https://status',
          responseUrl: 'https://response',
          cancelUrl: null,
          submittedAt: now,
        },
      } as ProviderSubmitResult);
      const zenmuxSubmit = vi.fn().mockResolvedValue({
        kind: 'sync',
        images: [{ url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 }],
      } as ProviderSubmitResult);
      const fal = makeProvider({ submit: falSubmit });
      const zenmux = makeProvider({
        id: 'zenmux',
        submit: zenmuxSubmit,
        capabilities: new Map([
          [
            'openai/gpt-image-2',
            {
              providerId: 'zenmux',
              model: 'openai/gpt-image-2',
              displayName: 'GPT Image 2',
              modes: ['text-to-image'],
              maxCount: 4,
              supportedSizes: ['1024x1024'],
              supportedAspectRatios: ['1:1'],
              supportsNegativePrompt: false,
              supportsSeed: false,
              protocol: 'sync',
              defaultSize: '1024x1024',
            },
          ],
        ]),
      });
      vi.mocked(providers.getById).mockImplementation((id) =>
        id === 'fal' ? fal : id === 'zenmux' ? zenmux : undefined,
      );

      const result = await submitGeneration(
        makeParams({
          targets: [
            { provider: 'fal', model: 'fal-ai/flux/schnell' },
            { provider: 'zenmux', model: 'openai/gpt-image-2' },
          ],
          aspectRatio: '1:1',
          width: 960,
          height: 1280,
          seed: 42,
        }),
        { db },
      );

      expect(result.status).toBe('pending');
      expect(falSubmit).toHaveBeenCalledWith(expect.objectContaining({ seed: 42 }), 'fal-ai/flux/schnell');
      expect(falSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ width: 960, height: 1280, aspectRatio: '1:1' }),
        'fal-ai/flux/schnell',
      );
      expect(zenmuxSubmit).toHaveBeenCalledWith(expect.objectContaining({ seed: undefined }), 'openai/gpt-image-2');
      expect(getGenerationWithJobsAndImages(result.generationId, db)!.jobs).toHaveLength(2);
    });

    it('keeps a completed target visible when a sibling target fails', async () => {
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });
      const fal = makeProvider({
        submit: vi.fn().mockResolvedValue({
          kind: 'failed',
          error: { code: 'PROVIDER_ERROR', message: 'Fal down', retryable: false },
        } as ProviderSubmitResult),
      });
      const zenmux = makeProvider({
        id: 'zenmux',
        submit: vi.fn().mockResolvedValue({
          kind: 'sync',
          images: [{ url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 }],
        } as ProviderSubmitResult),
        capabilities: new Map([
          [
            'openai/gpt-image-2',
            {
              providerId: 'zenmux', model: 'openai/gpt-image-2', displayName: 'GPT Image 2',
              modes: ['text-to-image'], maxCount: 4, supportedSizes: ['1024x1024'],
              supportedAspectRatios: ['1:1'], supportsNegativePrompt: false,
              supportsSeed: false, protocol: 'sync', defaultSize: '1024x1024',
            },
          ],
        ]),
      });
      vi.mocked(providers.getById).mockImplementation((id) =>
        id === 'fal' ? fal : id === 'zenmux' ? zenmux : undefined,
      );

      const result = await submitGeneration(
        makeParams({
          targets: [
            { provider: 'fal', model: 'fal-ai/flux/schnell' },
            { provider: 'zenmux', model: 'openai/gpt-image-2' },
          ],
          aspectRatio: '1:1',
        }),
        { db },
      );

      const view = await getGeneration(result.generationId, { db });
      expect(view.status).toBe('completed');
      expect(view.jobs.map((job) => job.status).sort()).toEqual(['completed', 'failed']);
    });

    it('touches session when sessionId provided', async () => {
      createSession({ id: 's1', projectId: 'default-project', title: 'Test', createdAt: now, updatedAt: now }, db);
      vi.mocked(providers.getById).mockReturnValue(
        makeProvider({
          submit: vi.fn().mockResolvedValue({
            kind: 'async',
            handle: {
              providerId: 'fal',
              model: 'fal-ai/flux/schnell',
              externalId: 'req-1',
              statusUrl: 'https://status',
              responseUrl: 'https://response',
              cancelUrl: null,
              submittedAt: now,
            },
          }),
        }),
      );

      await submitGeneration(
        makeParams({ sessionId: 's1' }),
        { db },
      );

      const session = db.select().from(sessions).where(eq(sessions.id, 's1')).get();
      expect(session!.updatedAt).not.toBe(now);
    });
  });

  describe('getGeneration', () => {
    it('throws NotFoundError for missing generation', async () => {
      await expect(getGeneration('missing', { db })).rejects.toThrow('Generation not found');
    });

    it('exposes only allowlisted job error fields and fixed safe policy', async () => {
      const canaries = {
        message:
          'private prompt https://signed.example/image.png?token=secret /private/app.db',
        prompt: 'private prompt',
        storagePath: '/private/app.db',
        providerPayload: { token: 'secret-provider-token' },
      };
      vi.mocked(providers.getById).mockReturnValue(
        makeProvider({
          submit: vi.fn().mockResolvedValue({
            kind: 'failed',
            error: {
              code: 'PROVIDER_ERROR',
              retryable: false,
              ...canaries,
            },
          } as unknown as ProviderSubmitResult),
        }),
      );

      const submitted = await submitGeneration(makeParams(), { db });
      const view = await getGeneration(submitted.generationId, { db });
      const serialized = JSON.stringify(view);

      expect(view.jobs[0]?.error).toEqual({
        code: 'PROVIDER_ERROR',
        message: 'Provider could not complete the job',
        retryable: true,
      });
      expect(serialized).not.toContain('private prompt');
      expect(serialized).not.toContain('signed.example');
      expect(serialized).not.toContain('token=secret');
      expect(serialized).not.toContain('/private/app.db');
      expect(serialized).not.toContain('secret-provider-token');
      expect(Object.keys(view.jobs[0]!.error!)).toEqual([
        'code',
        'message',
        'retryable',
      ]);
    });

    it('advances async job and returns completed', async () => {
      vi.mocked(storage.downloadAndStore).mockResolvedValue({
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      });

      const poll = vi.fn().mockResolvedValue({
        status: 'completed',
        images: [{ url: 'https://cdn.example.com/1.png', width: 1024, height: 1024, contentType: 'image/png', index: 0 }],
      } as PollResult);

      vi.mocked(providers.getById).mockReturnValue(
        makeProvider({
          submit: vi.fn().mockResolvedValue({
            kind: 'async',
            handle: {
              providerId: 'fal',
              model: 'fal-ai/flux/schnell',
              externalId: 'req-1',
              statusUrl: 'https://status',
              responseUrl: 'https://response',
              cancelUrl: null,
              submittedAt: now,
            },
          }),
          poll,
        }),
      );

      const submitResult = await submitGeneration(
        makeParams(),
        { db },
      );

      const view = await getGeneration(submitResult.generationId, { db });
      expect(view.status).toBe('completed');
      expect(view.images).toHaveLength(1);
      expect(view.images[0].url).toMatch(/^\/api\/images\//);
      expect(view.images[0].favorited).toBe(false);

      db.insert(favorites)
        .values({
          id: 'favorite-1',
          imageId: view.images[0].id,
          createdAt: now,
        })
        .run();

      const refreshed = await getGeneration(submitResult.generationId, { db });
      expect(refreshed.images[0].favorited).toBe(true);
    });
  });
});
