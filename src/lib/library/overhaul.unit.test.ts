import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../../tests/helpers/db';
import {
  addFavorite,
  createProject,
  createSession,
  ensureInitialSession,
  getProjectHistory,
  listFavorites,
  listGenerations,
  listProjectSummaries,
} from './index';

describe('frontend-overhaul read models', () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  it('ensures one default Session without changing explicit create semantics', () => {
    const project = createProject({ title: 'Empty project' }, testDb.db);

    const first = ensureInitialSession(project.id, testDb.db);
    const retried = ensureInitialSession(project.id, testDb.db);
    const additional = createSession({ projectId: project.id, title: 'Second' }, testDb.db);

    expect(first.created).toBe(true);
    expect(first.session.title).toBe(`session-${first.session.id.slice(0, 8)}`);
    expect(retried).toEqual({ session: first.session, created: false });
    expect(additional.id).not.toBe(first.session.id);
  });

  it('aggregates project cards with counts, stable activity ordering and a persisted cover URL', () => {
    const older = createProject({ title: 'Older' }, testDb.db);
    const newer = createProject({ title: 'Newer' }, testDb.db);
    const olderSession = createSession({ projectId: older.id }, testDb.db);
    const newerSession = createSession({ projectId: newer.id }, testDb.db);
    seedGeneration(testDb, {
      id: 'older-generation',
      sessionId: olderSession.id,
      createdAt: '2099-07-17T09:00:00.000Z',
      imageId: 'older-image',
    });
    seedGeneration(testDb, {
      id: 'newer-generation',
      sessionId: newerSession.id,
      createdAt: '2099-07-17T10:00:00.000Z',
      imageId: 'newer-image',
    });

    const summaries = listProjectSummaries(testDb.db);
    const newerSummary = summaries.find((summary) => summary.project.id === newer.id)!;

    expect(summaries.indexOf(newerSummary)).toBeLessThan(
      summaries.findIndex((summary) => summary.project.id === older.id),
    );
    expect(newerSummary).toMatchObject({
      sessionCount: 1,
      generationCount: 1,
      imageCount: 1,
      coverImageUrl: '/api/images/newer-image',
      lastActivityAt: '2099-07-17T10:00:00.000Z',
    });
  });

  it('groups only non-empty sessions, pages five groups, and bounds each initial generation page', () => {
    const project = createProject({ title: 'History' }, testDb.db);
    createSession({ projectId: project.id, title: 'Empty' }, testDb.db);
    const sessions = Array.from({ length: 6 }, (_, index) =>
      createSession({ projectId: project.id, title: `S${index + 1}` }, testDb.db),
    );
    for (const [sessionIndex, session] of sessions.entries()) {
      const count = sessionIndex === 0 ? 11 : 1;
      for (let generationIndex = 0; generationIndex < count; generationIndex += 1) {
        seedGeneration(testDb, {
          id: `history-${sessionIndex}-${generationIndex}`,
          sessionId: session.id,
          createdAt: `2026-07-17T${String(sessionIndex + 1).padStart(2, '0')}:${String(generationIndex).padStart(2, '0')}:00.000Z`,
        });
      }
    }

    const selectSpy = vi.spyOn(testDb.db, 'select');
    const firstPage = getProjectHistory({ projectId: project.id }, testDb.db);
    expect(selectSpy).toHaveBeenCalledTimes(7);
    selectSpy.mockClear();
    const secondPage = getProjectHistory({ projectId: project.id, page: 2 }, testDb.db);
    expect(selectSpy).toHaveBeenCalledTimes(7);
    selectSpy.mockRestore();
    const longGroup = [...firstPage.groups, ...secondPage.groups].find(
      (group) => group.generationCount === 11,
    )!;

    expect(firstPage.totalSessions).toBe(6);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.groups).toHaveLength(5);
    expect(secondPage.groups).toHaveLength(1);
    expect(firstPage.groups.map((group) => group.session.title)).toEqual([
      'S6',
      'S5',
      'S4',
      'S3',
      'S2',
    ]);
    expect(secondPage.groups[0]?.session.title).toBe('S1');
    expect(longGroup.items).toHaveLength(10);
    expect(longGroup.items.map((item) => item.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `history-0-${10 - index}`),
    );
    expect(longGroup.nextCursor).toEqual(expect.any(String));
    expect(
      listGenerations(
        {
          sessionId: longGroup.session.id,
          cursor: longGroup.nextCursor!,
          limit: 10,
        },
        testDb.db,
      ).items.map((item) => item.id),
    ).toEqual(['history-0-0']);
  });

  it('filters global favorites by project and provider before cursor pagination', () => {
    const project = createProject({ title: 'Gallery target' }, testDb.db);
    const session = createSession({ projectId: project.id }, testDb.db);
    seedGeneration(testDb, {
      id: 'target-fal',
      sessionId: session.id,
      createdAt: '2026-07-17T10:00:00.000Z',
      imageId: 'target-fal-image',
      provider: 'fal',
    });
    seedGeneration(testDb, {
      id: 'target-qwen',
      sessionId: session.id,
      createdAt: '2026-07-17T11:00:00.000Z',
      imageId: 'target-qwen-image',
      provider: 'qwen',
    });
    addFavorite('target-fal-image', testDb.db);
    addFavorite('target-qwen-image', testDb.db);

    const page = listFavorites(
      { projectId: project.id, provider: 'qwen', sort: 'newest' },
      testDb.db,
    );

    expect(page.items).toEqual([
      expect.objectContaining({
        imageId: 'target-qwen-image',
        projectId: project.id,
        provider: 'qwen',
      }),
    ]);
    expect(() => listFavorites({ provider: 'unknown' }, testDb.db)).toThrow(
      'Unknown provider',
    );
  });
});

function seedGeneration(
  testDb: TestDb,
  input: {
    id: string;
    sessionId: string;
    createdAt: string;
    imageId?: string;
    provider?: string;
  },
) {
  const jobId = `job-${input.id}`;
  testDb.sqlite
    .prepare(
      `INSERT INTO generations
       (id, session_id, prompt, status, created_at, updated_at)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
    )
    .run(input.id, input.sessionId, `Prompt ${input.id}`, input.createdAt, input.createdAt);
  testDb.sqlite
    .prepare(
      `INSERT INTO generation_jobs
       (id, generation_id, provider, model, status, provider_handle, error,
        poll_lease_until, next_poll_at, cancel_requested_at, created_at, updated_at)
       VALUES (?, ?, ?, 'model', 'completed', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(jobId, input.id, input.provider ?? 'fal', input.createdAt, input.createdAt);
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
