import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../../tests/helpers/db';
import { ConflictError, ImageUnavailableError, NotFoundError, StorageError } from '../errors';

vi.mock('../storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storage')>(),
  downloadAndStore: vi.fn(),
  removeStoredFile: vi.fn(),
}));

import { downloadAndStore, removeStoredFile } from '../storage';
import {
  addFavorite,
  createProject,
  createSession,
  deleteProject,
  getProjectHistory,
  listFavorites,
  listGenerations,
  listModelPreferences,
  listSessions,
  moveSession,
  upsertModelPreference,
} from './index';

describe('library domain', () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createTestDb();
    vi.mocked(downloadAndStore).mockReset();
    vi.mocked(removeStoredFile).mockReset();
  });

  afterEach(() => {
    testDb.sqlite.close();
    delete process.env.FAL_KEY;
  });

  it('requires every session to belong to an existing project', () => {
    expect(() =>
      createSession({ projectId: 'missing', title: 'No parent' }, testDb.db),
    ).toThrow(NotFoundError);
    expect(listSessions('default-project', testDb.db)).toHaveLength(1);

    expect(() =>
      testDb.sqlite
        .prepare(
          `INSERT INTO sessions
           (id, project_id, title, created_at, updated_at)
           VALUES ('orphan', NULL, NULL, 'now', 'now')`,
        )
        .run(),
    ).toThrow();
  });

  it('creates, lists and moves sessions without changing generation ownership', () => {
    const source = createProject({ title: 'Source' }, testDb.db);
    const target = createProject({ title: 'Target' }, testDb.db);
    const session = createSession(
      { projectId: source.id, title: 'Draft' },
      testDb.db,
    );
    seedGeneration(testDb, {
      generationId: 'generation-move',
      sessionId: session.id,
      createdAt: '2026-07-16T01:00:00.000Z',
    });

    expect(listSessions(source.id, testDb.db).map((item) => item.id)).toContain(
      session.id,
    );
    moveSession(session.id, { toProjectId: target.id }, testDb.db);

    expect(listSessions(source.id, testDb.db)).toEqual([]);
    expect(listSessions(target.id, testDb.db).map((item) => item.id)).toEqual([
      session.id,
    ]);
    expect(
      listGenerations({ projectId: target.id }, testDb.db).items[0]?.sessionId,
    ).toBe(session.id);
  });

  it('returns generation history newest-first with stable cursor pagination', () => {
    seedGeneration(testDb, {
      generationId: 'generation-old',
      sessionId: 'default-session',
      createdAt: '2026-07-16T01:00:00.000Z',
    });
    seedGeneration(testDb, {
      generationId: 'generation-new',
      sessionId: 'default-session',
      createdAt: '2026-07-16T02:00:00.000Z',
    });

    const first = listGenerations(
      { sessionId: 'default-session', limit: 1 },
      testDb.db,
    );
    expect(first.items.map((item) => item.id)).toEqual(['generation-new']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = listGenerations(
      {
        sessionId: 'default-session',
        limit: 1,
        cursor: first.nextCursor!,
      },
      testDb.db,
    );
    expect(second.items.map((item) => item.id)).toEqual(['generation-old']);
    expect(second.nextCursor).toBeNull();
    expect(() => listGenerations({ limit: Number.NaN }, testDb.db)).toThrow(
      'limit must be a positive integer',
    );
  });

  it('redacts persisted job diagnostics in generation and project history reads', () => {
    const canary = 'private prompt https://signed.example/image.png?token=secret';
    seedGeneration(testDb, {
      generationId: 'generation-private-error',
      sessionId: 'default-session',
      createdAt: '2026-07-16T03:00:00.000Z',
    });
    testDb.sqlite
      .prepare('UPDATE generation_jobs SET error = ? WHERE id = ?')
      .run(
        JSON.stringify({
          code: 'TIMEOUT',
          message: canary,
          retryable: false,
        }),
        'job-generation-private-error',
      );

    const summary = listGenerations(
      { sessionId: 'default-session' },
      testDb.db,
    ).items[0]!;
    const history = getProjectHistory({ projectId: 'default-project' }, testDb.db);

    expect(summary.jobs[0]?.error).toEqual({
      code: 'TIMEOUT',
      message: 'Provider request timed out',
      retryable: false,
    });
    expect(history.groups[0]?.items[0]?.jobs[0]?.error).toEqual(summary.jobs[0]?.error);
    expect(JSON.stringify({ summary, history })).not.toContain(canary);
  });

  it('returns 404 semantics for missing history targets', () => {
    expect(() => listGenerations({ sessionId: 'missing-session' }, testDb.db)).toThrow(
      NotFoundError,
    );
    expect(() => listGenerations({ projectId: 'missing-project' }, testDb.db)).toThrow(
      NotFoundError,
    );
    expect(() => listGenerations({ sessionId: '' }, testDb.db)).toThrow(
      'sessionId must not be empty',
    );
    expect(() => listGenerations({ projectId: '' }, testDb.db)).toThrow(
      'projectId must not be empty',
    );
  });

  it('favorites an image idempotently and returns its complete lineage', async () => {
    seedGeneration(testDb, {
      generationId: 'generation-gallery',
      sessionId: 'default-session',
      createdAt: '2026-07-16T03:00:00.000Z',
      imageId: 'image-gallery',
    });

    const first = await addFavorite('image-gallery', testDb.db);
    const second = await addFavorite('image-gallery', testDb.db);
    expect(second.favoriteId).toBe(first.favoriteId);
    expect(listFavorites({}, testDb.db).items).toEqual([
      expect.objectContaining({
        imageId: 'image-gallery',
        generationId: 'generation-gallery',
        sessionId: 'default-session',
        projectId: 'default-project',
        provider: 'fal',
        model: 'fal-ai/flux/schnell',
        prompt: 'Prompt generation-gallery',
      }),
    ]);
  });

  it('lists a missing favorite as a tombstone with no image URL', async () => {
    seedGeneration(testDb, {
      generationId: 'generation-missing-favorite',
      sessionId: 'default-session',
      createdAt: '2026-07-16T03:00:00.000Z',
      imageId: 'image-missing-favorite',
    });
    await addFavorite('image-missing-favorite', testDb.db);
    testDb.sqlite
      .prepare(
        `UPDATE images
         SET storage_path = NULL, removed_at = ?, removal_reason = 'storage_missing'
         WHERE id = ?`,
      )
      .run('2026-07-16T04:00:00.000Z', 'image-missing-favorite');

    expect(listFavorites({}, testDb.db).items).toEqual([
      expect.objectContaining({
        imageId: 'image-missing-favorite',
        url: null,
        availability: 'storage_missing',
        removedAt: '2026-07-16T04:00:00.000Z',
      }),
    ]);
  });

  it('pins a remote image before creating its favorite', async () => {
    seedRemoteImage(testDb, 'generation-remote-favorite', 'image-remote-favorite');
    vi.mocked(downloadAndStore).mockResolvedValue({
      storagePath: '2026/09/remote-favorite.png',
      contentType: 'image/png',
      sizeBytes: 1234,
    });

    const favorite = await addFavorite('image-remote-favorite', testDb.db);

    expect(downloadAndStore).toHaveBeenCalledWith(
      'https://v3.fal.media/result.png?token=secret',
    );
    expect(favorite).toMatchObject({
      imageId: 'image-remote-favorite',
      delivery: 'managed',
      availability: 'available',
    });
  });

  it('does not create a favorite when remote storage fails', async () => {
    seedRemoteImage(testDb, 'generation-remote-failure', 'image-remote-failure');
    vi.mocked(downloadAndStore).mockRejectedValue(
      new StorageError('Remote image download was rejected'),
    );

    await expect(addFavorite('image-remote-failure', testDb.db)).rejects.toBeInstanceOf(
      StorageError,
    );
    expect(listFavorites({}, testDb.db).items).toEqual([]);
  });

  it('removes newly stored bytes when a remote image expires before promotion', async () => {
    seedRemoteImage(testDb, 'generation-promotion-race', 'image-promotion-race');
    vi.mocked(downloadAndStore).mockImplementation(async () => {
      testDb.sqlite
        .prepare(
          `UPDATE images
           SET remote_url = NULL, remote_expires_at = NULL, removed_at = ?,
               removal_reason = 'remote_expired'
           WHERE id = ?`,
        )
        .run('2026-09-07T00:00:00.000Z', 'image-promotion-race');
      return {
        storagePath: '2026/09/lost-race.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      };
    });

    await expect(addFavorite('image-promotion-race', testDb.db)).rejects.toBeInstanceOf(
      ImageUnavailableError,
    );
    expect(removeStoredFile).toHaveBeenCalledWith('2026/09/lost-race.png');
    expect(listFavorites({}, testDb.db).items).toEqual([]);
  });

  it('removes newly stored bytes when another request already promoted the image', async () => {
    seedRemoteImage(testDb, 'generation-promotion-won', 'image-promotion-won');
    vi.mocked(downloadAndStore).mockImplementation(async () => {
      testDb.sqlite
        .prepare(
          `UPDATE images
           SET source_kind = 'managed', storage_path = '2026/09/first-writer.png',
               remote_url = NULL, remote_expires_at = NULL
           WHERE id = ?`,
        )
        .run('image-promotion-won');
      return {
        storagePath: '2026/09/second-writer.png',
        contentType: 'image/png',
        sizeBytes: 1234,
      };
    });

    await expect(addFavorite('image-promotion-won', testDb.db)).resolves.toMatchObject({
      imageId: 'image-promotion-won',
      delivery: 'managed',
    });
    expect(removeStoredFile).toHaveBeenCalledWith('2026/09/second-writer.png');
  });

  it('upserts only preferences for currently enabled registry models', () => {
    process.env.FAL_KEY = 'test-key';
    const preference = upsertModelPreference(
      {
        provider: 'fal',
        model: 'fal-ai/flux/schnell',
        enabled: false,
      },
      testDb.db,
    );
    expect(preference.enabled).toBe(false);
    expect(listModelPreferences(testDb.db)).toHaveLength(1);
    expect(() =>
      upsertModelPreference(
        { provider: 'fal', model: 'unknown', enabled: true },
        testDb.db,
      ),
    ).toThrow('enabled model');
  });

  it('deletes only empty projects', () => {
    expect(() => deleteProject('default-project', testDb.db)).toThrow(
      ConflictError,
    );
    const empty = createProject({ title: 'Empty' }, testDb.db);
    deleteProject(empty.id, testDb.db);
    expect(() => deleteProject(empty.id, testDb.db)).toThrow(NotFoundError);
  });
});

function seedRemoteImage(testDb: TestDb, generationId: string, imageId: string) {
  seedGeneration(testDb, {
    generationId,
    sessionId: 'default-session',
    createdAt: '2026-07-16T03:00:00.000Z',
  });
  testDb.sqlite
    .prepare(
      `INSERT INTO images
       (id, generation_job_id, "index", source_kind, storage_path, remote_url,
        remote_expires_at, content_type, width, height, size_bytes, created_at)
       VALUES (?, ?, 0, 'remote', NULL, ?, NULL, 'image/png', 1024, 1024, NULL, ?)`,
    )
    .run(
      imageId,
      `job-${generationId}`,
      'https://v3.fal.media/result.png?token=secret',
      '2026-07-16T03:00:00.000Z',
    );
}

function seedGeneration(
  testDb: TestDb,
  input: {
    generationId: string;
    sessionId: string;
    createdAt: string;
    imageId?: string;
  },
) {
  const jobId = `job-${input.generationId}`;
  testDb.sqlite
    .prepare(
      `INSERT INTO generations
       (id, session_id, prompt, status, created_at, updated_at)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
    )
    .run(
      input.generationId,
      input.sessionId,
      `Prompt ${input.generationId}`,
      input.createdAt,
      input.createdAt,
    );
  testDb.sqlite
    .prepare(
      `INSERT INTO generation_jobs
       (id, generation_id, provider, model, status, provider_handle, error,
        poll_lease_until, created_at, updated_at)
       VALUES (?, ?, 'fal', 'fal-ai/flux/schnell', 'completed', NULL, NULL,
               NULL, ?, ?)`,
    )
    .run(jobId, input.generationId, input.createdAt, input.createdAt);
  if (input.imageId) {
    testDb.sqlite
      .prepare(
        `INSERT INTO images
         (id, generation_job_id, "index", storage_path, content_type, width,
          height, size_bytes, created_at)
         VALUES (?, ?, 0, '/tmp/image.png', 'image/png', 1024, 1024, 1, ?)`,
      )
      .run(input.imageId, jobId, input.createdAt);
  }
}
