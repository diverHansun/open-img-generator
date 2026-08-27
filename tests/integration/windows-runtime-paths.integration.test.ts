import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { updateAppSettings, readStoredAppSettings } from '../../src/lib/app-settings';
import { logSafeEvent } from '../../src/lib/observability/safe-logger';
import { resolveRuntimePaths } from '../../src/lib/runtime-paths/core.js';
import { preflightRuntimePaths } from '../../src/lib/runtime-paths/preflight.js';
import { downloadAndStore, stageInlineImage } from '../../src/lib/storage';
import {
  clearCredentialCache,
  readEncryptedCredentials,
  writeCredentials,
} from '../../src/lib/user-config';
import { initializeTestSchema } from '../helpers/db-schema';

describe('Windows runtime paths integration', () => {
  const originalEnvironment = { ...process.env };
  let root: string;
  let sqlite: Database.Database | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'Open Image Generator 测试 空格 '));
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env.DATABASE_URL = `file:${path.join(root, 'database', 'app.db')}`;
    process.env.LOCAL_STORAGE_DIR = path.join(root, '图片');
    process.env.USER_CONFIG_DIR = path.join(root, '用户 配置');
    process.env.APP_LOG_DIR = path.join(root, '运行 日志');
    process.env.USER_CONFIG_ENCRYPTION_KEY = 'integration-master-secret';
    process.env.APP_FILE_LOG_ENABLED = '1';
    clearCredentialCache();
  });

  afterEach(() => {
    if (sqlite?.open) sqlite.close();
    sqlite = undefined;
    process.env = { ...originalEnvironment };
    clearCredentialCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('coordinates SQLite, storage, settings, credentials and safe logs', async () => {
    const runtimePaths = resolveRuntimePaths({
      projectRoot: process.cwd(),
      mode: 'development',
      platform: process.platform,
      env: process.env,
      homeDirectory: os.homedir(),
    });
    expect(preflightRuntimePaths(runtimePaths)).toEqual({ warnings: [] });

    sqlite = new Database(runtimePaths.databasePath);
    sqlite.pragma('foreign_keys = ON');
    initializeTestSchema(sqlite);

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('integration-png'),
    ]);
    const staged = stageInlineImage(
      `data:image/png;base64,${png.toString('base64')}`,
    );
    expect(staged.reference).toMatch(/^staging:/);
    expect(fs.readdirSync(path.join(runtimePaths.storageRoot, '.staging'))).toHaveLength(1);
    const stored = await downloadAndStore(staged.reference);
    expect(stored.storagePath).toMatch(/^\d{4}\/\d{2}\/.+\.png$/);
    expect(stored.storagePath).not.toContain('\\');
    const storedPath = path.join(
      runtimePaths.storageRoot,
      ...stored.storagePath.split('/'),
    );
    expect(fs.readFileSync(storedPath)).toEqual(png);

    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO generations
       (id, session_id, prompt, status, created_at, updated_at)
       VALUES ('integration-generation', 'default-session', 'safe prompt', 'completed', ?, ?)`,
    ).run(now, now);
    sqlite.prepare(
      `INSERT INTO generation_jobs
       (id, generation_id, provider, model, status, created_at, updated_at)
       VALUES ('integration-job', 'integration-generation', 'test', 'test-model', 'completed', ?, ?)`,
    ).run(now, now);
    sqlite.prepare(
      `INSERT INTO images
       (id, generation_job_id, "index", storage_path, content_type, size_bytes, created_at)
       VALUES ('integration-image', 'integration-job', 0, ?, ?, ?, ?)`,
    ).run(stored.storagePath, stored.contentType, stored.sizeBytes, now);
    expect(
      sqlite.prepare(
        `SELECT storage_path FROM images WHERE id = 'integration-image'`,
      ).pluck().get(),
    ).toBe(stored.storagePath);
    sqlite.close();

    updateAppSettings({ imageRetentionDays: 30 });
    expect(readStoredAppSettings()).toEqual({ version: 1, imageRetentionDays: 30 });
    writeCredentials({ FAL_KEY: 'integration-secret' });
    expect(readEncryptedCredentials()).toEqual({ FAL_KEY: 'integration-secret' });
    expect(fs.readdirSync(runtimePaths.userConfigDirectory).some((name) => name.endsWith('.tmp'))).toBe(false);

    logSafeEvent({
      event: 'storage.missing_detected',
      imageId: 'integration-image',
      wasFavorite: false,
    });
    const log = fs.readFileSync(path.join(runtimePaths.logDirectory, 'app.jsonl'), 'utf8');
    expect(log).toContain('storage.missing_detected');
    expect(log).not.toContain(root);

    process.env.DATABASE_URL = `file:${path.join(root, 'database', 'other.db')}`;
    expect(() => stageInlineImage(
      `data:image/png;base64,${png.toString('base64')}`,
    )).toThrow('Storage directory ownership could not be verified');
  });
});
