import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../tests/helpers/db';
import { ConflictError, NotFoundError } from '../errors';
import {
  addFavorite,
  createProject,
  createSession,
  deleteProject,
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

  it('returns 404 semantics for missing history targets', () => {
    expect(() => listGenerations({ sessionId: 'missing-session' }, testDb.db)).toThrow(
      NotFoundError,
    );
    expect(() => listGenerations({ projectId: 'missing-project' }, testDb.db)).toThrow(
      NotFoundError,
    );
  });

  it('favorites an image idempotently and returns its complete lineage', () => {
    seedGeneration(testDb, {
      generationId: 'generation-gallery',
      sessionId: 'default-session',
      createdAt: '2026-07-16T03:00:00.000Z',
      imageId: 'image-gallery',
    });

    const first = addFavorite('image-gallery', testDb.db);
    const second = addFavorite('image-gallery', testDb.db);
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
