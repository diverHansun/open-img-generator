import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../../tests/helpers/db';
import { createSession } from '../db/queries/sessions';
import { sessions } from '../db';
import { submitGeneration, getGeneration } from './orchestrator';
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
            supportedAspectRatios: [],
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

  describe('submitGeneration', () => {
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
        { provider: 'fal', model: 'fal-ai/flux/schnell', prompt: 'A cat' },
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
        { provider: 'zenmux', model: 'openai/gpt-image-2', prompt: 'A cat' },
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
        { provider: 'fal', model: 'fal-ai/flux/schnell', prompt: 'A cat' },
        { db },
      );

      expect(result.status).toBe('failed');
    });

    it('touches session when sessionId provided', async () => {
      createSession({ id: 's1', title: 'Test', createdAt: now, updatedAt: now }, db);
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
        { provider: 'fal', model: 'fal-ai/flux/schnell', prompt: 'A cat', sessionId: 's1' },
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
        { provider: 'fal', model: 'fal-ai/flux/schnell', prompt: 'A cat' },
        { db },
      );

      const view = await getGeneration(submitResult.generationId, { db });
      expect(view.status).toBe('completed');
      expect(view.images).toHaveLength(1);
      expect(view.images[0].url).toMatch(/^\/api\/images\//);
    });
  });
});

