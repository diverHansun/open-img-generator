import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDbClient, type DbClient } from '../../src/lib/db';
import {
  addFavorite,
  createProject,
  createSession,
  ensureInitialSession,
  getProjectHistory,
  listFavorites,
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
});

function seedGeneration(
  sqlite: Database.Database,
  input: {
    id: string;
    sessionId: string;
    provider: string;
    createdAt: string;
    imageId: string;
  },
) {
  const jobId = `job-${input.id}`;
  sqlite
    .prepare(
      `INSERT INTO generations
       (id, session_id, prompt, status, created_at, updated_at)
       VALUES (?, ?, 'Prompt', 'completed', ?, ?)`,
    )
    .run(input.id, input.sessionId, input.createdAt, input.createdAt);
  sqlite
    .prepare(
      `INSERT INTO generation_jobs
       (id, generation_id, provider, model, status, provider_handle, error,
        poll_lease_until, next_poll_at, cancel_requested_at, created_at, updated_at)
       VALUES (?, ?, ?, 'model', 'completed', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(jobId, input.id, input.provider, input.createdAt, input.createdAt);
  sqlite
    .prepare(
      `INSERT INTO images
       (id, generation_job_id, "index", storage_path, content_type, width,
        height, size_bytes, created_at)
       VALUES (?, ?, 0, '/tmp/image.png', 'image/png', 512, 512, 1, ?)`,
    )
    .run(input.imageId, jobId, input.createdAt);
}
