import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDbClient, type DbClient } from '../../src/lib/db';
import {
  ConfigurationUnavailableError,
} from '../../src/lib/errors';
import {
  addFavorite,
  createProject,
  createSession,
  ensureInitialSession,
  getProjectHistory,
  listFavorites,
  listGenerations,
  listProjectSummaries,
} from '../../src/lib/library';
import {
  getCredentialsFilePath,
  readEncryptedCredentials,
} from '../../src/lib/user-config';
import {
  listProviderConfigurations,
  removeProviderCredential,
  resetProviderConfigurationState,
  setProviderCredential,
} from '../../src/lib/provider-config';
import { createIntegrationDb } from '../helpers/integration';

describe('frontend-overhaul backend data integration', () => {
  let db: DbClient;
  let sqlite: Database.Database;
  let cleanupDb: () => void;
  let credentialsDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    const integrationDb = createIntegrationDb();
    db = createDbClient(integrationDb.tempFile);
    sqlite = new Database(integrationDb.tempFile);
    sqlite.pragma('foreign_keys = ON');
    cleanupDb = integrationDb.cleanup;
    credentialsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-config-int-'));
    process.env.USER_CONFIG_DIR = credentialsDir;
    process.env.USER_CONFIG_ENCRYPTION_KEY = 'integration-master-key';
    delete process.env.FAL_KEY;
    delete process.env.KLING_API_KEY;
    resetProviderConfigurationState();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetProviderConfigurationState();
    fs.rmSync(credentialsDir, { recursive: true, force: true });
    sqlite.close();
    cleanupDb();
  });

  it('keeps summary, History and Gallery reads local and excludes empty sessions', () => {
    const project = createProject({ title: 'Visual project' }, db);
    createSession({ projectId: project.id, title: 'Empty session' }, db);
    const firstSession = createSession({ projectId: project.id, title: 'First' }, db);
    const secondSession = createSession({ projectId: project.id, title: 'Second' }, db);
    seedGeneration(sqlite, {
      id: 'generation-fal',
      sessionId: firstSession.id,
      provider: 'fal',
      createdAt: '2099-07-18T09:00:00.000Z',
      imageId: 'image-fal',
    });
    seedGeneration(sqlite, {
      id: 'generation-qwen',
      sessionId: secondSession.id,
      provider: 'qwen',
      createdAt: '2099-07-18T10:00:00.000Z',
      imageId: 'image-qwen',
    });
    addFavorite('image-fal', db);
    addFavorite('image-qwen', db);

    const summary = listProjectSummaries(db).find((item) => item.project.id === project.id)!;
    const history = getProjectHistory({ projectId: project.id }, db);
    const gallery = listFavorites({ projectId: project.id, provider: 'qwen' }, db);

    expect(summary).toMatchObject({
      sessionCount: 3,
      generationCount: 2,
      imageCount: 2,
      coverImageUrl: '/api/images/image-qwen',
    });
    expect(history).toMatchObject({
      totalSessions: 2,
      totals: { generations: 2, images: 2 },
    });
    expect(history.groups.map((group) => group.session.title)).not.toContain('Empty session');
    expect(gallery.items).toEqual([
      expect.objectContaining({ imageId: 'image-qwen', provider: 'qwen' }),
    ]);
  });

  it('returns the same initial Session across retries and preserves explicit additions', async () => {
    const project = createProject({ title: 'Initial session' }, db);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => ensureInitialSession(project.id, db)),
      Promise.resolve().then(() => ensureInitialSession(project.id, db)),
    ]);
    const explicit = createSession({ projectId: project.id, title: 'Explicit' }, db);

    expect(first.session.id).toBe(second.session.id);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(explicit.id).not.toBe(first.session.id);
  });

  it('keeps History and generation-list reads from advancing a pending provider job', () => {
    const project = createProject({ title: 'Read-only history' }, db);
    const session = createSession({ projectId: project.id, title: 'Pending' }, db);
    seedGeneration(sqlite, {
      id: 'generation-pending',
      sessionId: session.id,
      provider: 'fal',
      createdAt: '2099-07-18T10:00:00.000Z',
      imageId: 'image-pending',
      generationStatus: 'running',
      jobStatus: 'running',
      nextPollAt: '2099-07-18T10:01:00.000Z',
    });
    const before = sqlite
      .prepare('SELECT status, next_poll_at, poll_lease_until FROM generation_jobs WHERE id = ?')
      .get('job-generation-pending');

    getProjectHistory({ projectId: project.id }, db);
    listGenerations({ sessionId: session.id }, db);

    expect(
      sqlite
        .prepare('SELECT status, next_poll_at, poll_lease_until FROM generation_jobs WHERE id = ?')
        .get('job-generation-pending'),
    ).toEqual(before);
  });

  it('filters Gallery before pagination and returns each matching favorite exactly once', () => {
    const firstProject = createProject({ title: 'First project' }, db);
    const secondProject = createProject({ title: 'Second project' }, db);
    const firstSession = createSession({ projectId: firstProject.id, title: 'First session' }, db);
    const secondSession = createSession({ projectId: secondProject.id, title: 'Second session' }, db);
    seedGeneration(sqlite, {
      id: 'gallery-qwen-older',
      sessionId: firstSession.id,
      provider: 'qwen',
      createdAt: '2099-07-18T09:00:00.000Z',
      imageId: 'image-gallery-qwen-older',
    });
    seedFavorite(sqlite, 'favorite-qwen-older', 'image-gallery-qwen-older', '2099-07-18T09:00:00.000Z');
    seedGeneration(sqlite, {
      id: 'gallery-qwen-newer',
      sessionId: firstSession.id,
      provider: 'qwen',
      createdAt: '2099-07-18T10:00:00.000Z',
      imageId: 'image-gallery-qwen-newer',
    });
    seedFavorite(sqlite, 'favorite-qwen-newer', 'image-gallery-qwen-newer', '2099-07-18T10:00:00.000Z');
    seedGeneration(sqlite, {
      id: 'gallery-fal-latest',
      sessionId: firstSession.id,
      provider: 'fal',
      createdAt: '2099-07-18T11:00:00.000Z',
      imageId: 'image-gallery-fal-latest',
    });
    seedFavorite(sqlite, 'favorite-fal-latest', 'image-gallery-fal-latest', '2099-07-18T11:00:00.000Z');
    seedGeneration(sqlite, {
      id: 'gallery-qwen-other-project',
      sessionId: secondSession.id,
      provider: 'qwen',
      createdAt: '2099-07-18T12:00:00.000Z',
      imageId: 'image-gallery-qwen-other-project',
    });
    seedFavorite(
      sqlite,
      'favorite-qwen-other-project',
      'image-gallery-qwen-other-project',
      '2099-07-18T12:00:00.000Z',
    );

    const firstPage = listFavorites(
      { projectId: firstProject.id, provider: 'qwen', limit: 1, sort: 'newest' },
      db,
    );
    const secondPage = listFavorites(
      {
        projectId: firstProject.id,
        provider: 'qwen',
        limit: 1,
        sort: 'newest',
        cursor: firstPage.nextCursor ?? undefined,
      },
      db,
    );

    expect(firstPage.items.map((item) => item.imageId)).toEqual(['image-gallery-qwen-newer']);
    expect(secondPage.items.map((item) => item.imageId)).toEqual(['image-gallery-qwen-older']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('persists independent credential updates atomically and never returns the secret in summaries', async () => {
    const canary = 'secret-e2e-canary-integration';

    const [fal, kling] = await Promise.all([
      setProviderCredential('fal', canary, db),
      setProviderCredential('kling', 'kling-key', db),
    ]);
    const summaries = listProviderConfigurations(db);
    await removeProviderCredential('fal', db);

    expect(JSON.stringify(fal)).not.toContain(canary);
    expect(JSON.stringify(kling)).not.toContain(canary);
    expect(JSON.stringify(summaries)).not.toContain(canary);
    expect(fs.readFileSync(getCredentialsFilePath(), 'utf8')).not.toContain(canary);
    expect(readEncryptedCredentials()).toEqual({ KLING_API_KEY: 'kling-key' });
  });

  it('does not leak or overwrite credentials when encrypted storage is unavailable', async () => {
    const canary = 'secret-e2e-canary-unavailable';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const credentialsPath = getCredentialsFilePath();
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    const corruptedEnvelope = `{"ciphertext":"${canary}"}\n`;
    fs.writeFileSync(credentialsPath, corruptedEnvelope, { mode: 0o600 });

    expect(() => listProviderConfigurations(db)).toThrow(ConfigurationUnavailableError);
    try {
      listProviderConfigurations(db);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationUnavailableError);
      expect(error instanceof Error ? error.message : '').not.toContain(canary);
    }
    expect(fs.readFileSync(credentialsPath, 'utf8')).toBe(corruptedEnvelope);

    fs.rmSync(credentialsPath);
    resetProviderConfigurationState();
    delete process.env.USER_CONFIG_ENCRYPTION_KEY;
    await expect(setProviderCredential('fal', canary, db)).rejects.toBeInstanceOf(
      ConfigurationUnavailableError,
    );
    expect(fs.existsSync(credentialsPath)).toBe(false);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(canary);
    consoleError.mockRestore();
  });
});

function seedGeneration(
  sqlite: Database.Database,
  input: {
    id: string;
    sessionId: string;
    provider: string;
    createdAt: string;
    imageId: string;
    generationStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    jobStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    nextPollAt?: string | null;
  },
) {
  const jobId = `job-${input.id}`;
  sqlite
    .prepare(
      `INSERT INTO generations
       (id, session_id, prompt, status, created_at, updated_at)
       VALUES (?, ?, 'Prompt', ?, ?, ?)`,
    )
    .run(
      input.id,
      input.sessionId,
      input.generationStatus ?? 'completed',
      input.createdAt,
      input.createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO generation_jobs
       (id, generation_id, provider, model, status, provider_handle, error,
        poll_lease_until, next_poll_at, cancel_requested_at, created_at, updated_at)
       VALUES (?, ?, ?, 'model', ?, NULL, NULL, NULL, ?, NULL, ?, ?)`,
    )
    .run(
      jobId,
      input.id,
      input.provider,
      input.jobStatus ?? 'completed',
      input.nextPollAt ?? null,
      input.createdAt,
      input.createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO images
       (id, generation_job_id, "index", storage_path, content_type, width,
        height, size_bytes, created_at)
       VALUES (?, ?, 0, '/tmp/image.png', 'image/png', 512, 512, 1, ?)`,
    )
    .run(input.imageId, jobId, input.createdAt);
}

function seedFavorite(
  sqlite: Database.Database,
  id: string,
  imageId: string,
  createdAt: string,
) {
  sqlite
    .prepare('INSERT INTO favorites (id, image_id, created_at) VALUES (?, ?, ?)')
    .run(id, imageId, createdAt);
}
