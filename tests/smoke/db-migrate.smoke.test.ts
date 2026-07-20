import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { inspectDatabaseCompatibility } from '../../src/lib/db/compatibility';
import * as schema from '../../src/lib/db/schema';
import schemaManifest from '../../src/lib/db/schema-manifest.json';
import { initializeTestSchema } from '../helpers/db-schema';

const targetVersion = schemaManifest.version;

function removeSqliteFiles(file: string) {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
  fs.rmSync(`${file}.pre-migrate-v0-to-v1.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v0-to-v1.bak.1`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v1-to-v1.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v0-to-v2.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v0-to-v2.bak.1`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v1-to-v2.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v2-to-v2.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v0-to-v3.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v0-to-v3.bak.1`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v1-to-v3.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v2-to-v3.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v3-to-v3.bak`, { force: true });
  fs.rmSync(`${file}.migrate.lock`, { force: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    fs.rmSync(`${file}.migrate-lock.sqlite${suffix}`, { force: true });
  }
}

function runMigration(root: string, file: string) {
  return JSON.parse(
    execFileSync(process.execPath, ['scripts/migrate-db.mjs'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: `file:${file}` },
      encoding: 'utf8',
    }),
  ) as {
    fromVersion: number;
    toVersion: number;
    backupPath: string | null;
    addedColumns: string[];
    deletedOrphanGenerations: number;
    jobPhaseBackfill: {
      terminal: number;
      polling: number;
      cancelling: number;
      outcomeUnknown: number;
    };
    generations: number;
  };
}

function runFailedMigration(
  root: string,
  file: string,
  environment: Record<string, string | undefined> = {},
) {
  return spawnSync(process.execPath, ['scripts/migrate-db.mjs'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${file}`, ...environment },
    encoding: 'utf8',
  });
}

function runMigrationAsync(root: string, file: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(process.execPath, ['scripts/migrate-db.mjs'], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    },
  );
}

function startLockHolder(file: string) {
  return new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import Database from 'better-sqlite3';
          const lock = new Database(process.env.MIGRATION_TEST_LOCK_PATH);
          lock.exec('CREATE TABLE IF NOT EXISTS migration_lock (id INTEGER PRIMARY KEY)');
          lock.exec('BEGIN IMMEDIATE');
          process.stdout.write('locked\\n');
          setInterval(() => void lock.inTransaction, 1_000);
        `,
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        env: {
          ...process.env,
          MIGRATION_TEST_LOCK_PATH: `${file}.migrate-lock.sqlite`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let settled = false;
    child.once('error', reject);
    child.once('close', (status) => {
      if (!settled) reject(new Error(`Lock holder exited early with ${status}`));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!settled && chunk.includes('locked')) {
        settled = true;
        resolve(child);
      }
    });
  });
}

describe('db:migrate', () => {
  it('drops legacy orphan generations and produces an idempotent valid schema', () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(os.tmpdir(), `ai-image-migrate-${Date.now()}.db`);
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE generations (
        id TEXT PRIMARY KEY, session_id TEXT, prompt TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE generation_jobs (
        id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, provider TEXT NOT NULL,
        model TEXT NOT NULL, status TEXT NOT NULL, provider_handle TEXT, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE images (
        id TEXT PRIMARY KEY, generation_job_id TEXT NOT NULL, "index" INTEGER NOT NULL,
        storage_path TEXT NOT NULL, content_type TEXT NOT NULL, width INTEGER,
        height INTEGER, size_bytes INTEGER, created_at TEXT NOT NULL
      );
    `);
    const insertGeneration = legacy.prepare(
      `INSERT INTO generations VALUES (?, NULL, ?, 'completed', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z')`,
    );
    for (let index = 1; index <= 7; index += 1) {
      insertGeneration.run(`legacy-generation-${index}`, `Prompt ${index}`);
    }
    legacy.exec(`
      INSERT INTO sessions VALUES
        ('valid-session', 'Legacy session', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z');
      INSERT INTO generations VALUES
        ('valid-generation', 'valid-session', 'A preserved prompt', 'completed',
         '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z');
    `);
    legacy.exec(`
      INSERT INTO generation_jobs VALUES (
        'legacy-job', 'legacy-generation-1', 'fal', 'fal-ai/flux/schnell',
        'completed', NULL, NULL, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'
      );
      INSERT INTO images VALUES (
        'legacy-image', 'legacy-job', 0, '/tmp/legacy.png', 'image/png',
        1024, 1024, 1, '2026-07-16T00:00:00.000Z'
      );
    `);
    legacy.close();

    try {
      const first = runMigration(root, file);
      expect(first).toMatchObject({
        fromVersion: 0,
        toVersion: targetVersion,
        deletedOrphanGenerations: 7,
        generations: 1,
      });
      expect(first.backupPath).toBe(
        `${file}.pre-migrate-v0-to-v${targetVersion}.bak`,
      );
      expect(fs.existsSync(first.backupPath!)).toBe(true);

      const second = runMigration(root, file);
      expect(second).toMatchObject({
        fromVersion: targetVersion,
        toVersion: targetVersion,
        backupPath: null,
        deletedOrphanGenerations: 0,
        generations: 1,
      });

      const migrated = new Database(file);
      migrated.pragma('foreign_keys = ON');
      expect(migrated.pragma('user_version', { simple: true })).toBe(
        targetVersion,
      );
      expect(migrated.pragma('foreign_key_check')).toEqual([]);
      expect(inspectDatabaseCompatibility(drizzle(migrated, { schema }))).toMatchObject({
        ready: true,
        missingTables: [],
        missingColumns: [],
        missingIndexes: [],
      });
      expect(
        migrated.prepare('SELECT id, session_id FROM generations').all(),
      ).toEqual([{ id: 'valid-generation', session_id: 'valid-session' }]);
      expect(migrated.prepare('SELECT COUNT(*) AS count FROM images').get()).toEqual({
        count: 0,
      });
      const sessionColumns = migrated.pragma('table_info(sessions)') as Array<{
        name: string;
        notnull: number;
      }>;
      const generationColumns = migrated.pragma('table_info(generations)') as Array<{
        name: string;
        notnull: number;
      }>;
      expect(
        sessionColumns.find((column) => column.name === 'project_id'),
      ).toMatchObject({ notnull: 1 });
      expect(
        generationColumns.find((column) => column.name === 'session_id'),
      ).toMatchObject({ notnull: 1 });
      const names = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      expect(names).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'projects' }),
          expect.objectContaining({ name: 'favorites' }),
          expect.objectContaining({ name: 'model_preferences' }),
        ]),
      );
      migrated.close();
    } finally {
      removeSqliteFiles(file);
    }
  });

  it('upgrades the previous project schema without losing generation data', () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(os.tmpdir(), `ai-image-current-migrate-${Date.now()}.db`);
    const previous = new Database(file);
    previous.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE generations (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), prompt TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE generation_jobs (
        id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
        provider_handle TEXT, error TEXT, poll_lease_until TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE images (
        id TEXT PRIMARY KEY, generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
        "index" INTEGER NOT NULL, storage_path TEXT NOT NULL, content_type TEXT NOT NULL,
        width INTEGER, height INTEGER, size_bytes INTEGER, created_at TEXT NOT NULL
      );
      CREATE TABLE favorites (
        id TEXT PRIMARY KEY, image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE model_preferences (
        provider TEXT NOT NULL, model TEXT NOT NULL, enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(provider, model)
      );
      CREATE INDEX projects_updated_at_idx ON projects(updated_at);
      CREATE INDEX sessions_project_updated_at_idx ON sessions(project_id, updated_at);
      CREATE INDEX generations_session_created_at_idx ON generations(session_id, created_at);
      CREATE INDEX generations_created_at_idx ON generations(created_at);
      CREATE INDEX generation_jobs_generation_idx ON generation_jobs(generation_id);
      CREATE UNIQUE INDEX unique_job_index ON images(generation_job_id, "index");
      CREATE UNIQUE INDEX favorites_image_unique ON favorites(image_id);
      CREATE INDEX favorites_created_at_idx ON favorites(created_at);
      INSERT INTO projects VALUES ('project-1', 'Project', 'now', 'now');
      INSERT INTO sessions VALUES ('session-1', 'project-1', 'Session', 'now', 'now');
      INSERT INTO generations VALUES ('generation-1', 'session-1', 'Preserve me', 'pending', 'now', 'now');
      INSERT INTO generation_jobs VALUES (
        'job-1', 'generation-1', 'fal', 'fal-ai/flux/schnell', 'pending', NULL, NULL, NULL, 'now', 'now'
      );
    `);
    previous.close();

    try {
      const first = runMigration(root, file);

      expect(first).toMatchObject({
        fromVersion: 0,
        toVersion: targetVersion,
        addedColumns: [
          'generation_jobs.next_poll_at',
          'generation_jobs.cancel_requested_at',
          'generations.client_request_id',
          'generations.request_hash',
          'generation_jobs.phase',
          'generation_jobs.request_snapshot',
          'generation_jobs.request_snapshot_version',
          'generation_jobs.result_snapshot',
          'generation_jobs.attempt_count',
          'generation_jobs.retry_started_at',
        ],
        deletedOrphanGenerations: 0,
        generations: 1,
      });
      expect(first.backupPath).toBe(
        `${file}.pre-migrate-v0-to-v${targetVersion}.bak`,
      );
      expect(fs.existsSync(first.backupPath!)).toBe(true);

      const migrated = new Database(file);
      expect(migrated.pragma('user_version', { simple: true })).toBe(
        targetVersion,
      );
      expect(migrated.pragma('foreign_key_check')).toEqual([]);
      expect(
        migrated.prepare('SELECT id, prompt, status FROM generations').all(),
      ).toEqual([
        { id: 'generation-1', prompt: 'Preserve me', status: 'failed' },
      ]);
      expect(
        migrated.prepare('SELECT id, generation_id, provider_handle, phase, status FROM generation_jobs').all(),
      ).toEqual([
        {
          id: 'job-1',
          generation_id: 'generation-1',
          provider_handle: null,
          phase: 'outcome_unknown',
          status: 'failed',
        },
      ]);
      const jobColumns = migrated.pragma('table_info(generation_jobs)') as Array<{ name: string }>;
      expect(jobColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'next_poll_at',
          'cancel_requested_at',
          'phase',
          'request_snapshot',
          'request_snapshot_version',
          'result_snapshot',
          'attempt_count',
          'retry_started_at',
        ]),
      );
      migrated.close();

      const second = runMigration(root, file);
      expect(second).toMatchObject({
        fromVersion: targetVersion,
        toVersion: targetVersion,
        backupPath: null,
        addedColumns: [],
        generations: 1,
      });
    } finally {
      removeSqliteFiles(file);
    }
  });

  it('upgrades a version 1 database additively and preserves existing rows', () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(
      os.tmpdir(),
      `ai-image-v1-idempotency-migrate-${Date.now()}.db`,
    );
    const previous = new Database(file);
    initializeTestSchema(previous);
    previous.exec(`
      DROP INDEX generations_client_request_id_unique;
      DROP INDEX generation_jobs_due_idx;
      ALTER TABLE generations DROP COLUMN client_request_id;
      ALTER TABLE generations DROP COLUMN request_hash;
      ALTER TABLE generation_jobs DROP COLUMN retry_started_at;
      ALTER TABLE generation_jobs DROP COLUMN attempt_count;
      ALTER TABLE generation_jobs DROP COLUMN result_snapshot;
      ALTER TABLE generation_jobs DROP COLUMN request_snapshot_version;
      ALTER TABLE generation_jobs DROP COLUMN request_snapshot;
      ALTER TABLE generation_jobs DROP COLUMN phase;
      PRAGMA user_version = 1;
      INSERT INTO generations
        (id, session_id, prompt, status, created_at, updated_at)
      VALUES
        ('generation-v1', 'default-session', 'Preserve v1 generation', 'pending', 'before', 'before');
      INSERT INTO generation_jobs
        (id, generation_id, provider, model, status, provider_handle, error,
         poll_lease_until, next_poll_at, cancel_requested_at, created_at, updated_at)
      VALUES
        ('job-v1', 'generation-v1', 'fal', 'fal-ai/flux/schnell', 'pending',
         NULL, NULL, NULL, NULL, NULL, 'before', 'before');
    `);
    previous.close();

    try {
      const report = runMigration(root, file);
      expect(report).toMatchObject({
        fromVersion: 1,
        toVersion: targetVersion,
        backupPath: `${file}.pre-migrate-v1-to-v${targetVersion}.bak`,
        addedColumns: [
          'generations.client_request_id',
          'generations.request_hash',
          'generation_jobs.phase',
          'generation_jobs.request_snapshot',
          'generation_jobs.request_snapshot_version',
          'generation_jobs.result_snapshot',
          'generation_jobs.attempt_count',
          'generation_jobs.retry_started_at',
        ],
        generations: 1,
      });

      const migrated = new Database(file);
      migrated.pragma('foreign_keys = ON');
      expect(migrated.pragma('user_version', { simple: true })).toBe(
        targetVersion,
      );
      expect(migrated.pragma('foreign_key_check')).toEqual([]);
      expect(
        migrated
          .prepare(
            `SELECT id, prompt, client_request_id, request_hash
             FROM generations WHERE id = 'generation-v1'`,
          )
          .get(),
      ).toEqual({
        id: 'generation-v1',
        prompt: 'Preserve v1 generation',
        client_request_id: null,
        request_hash: null,
      });
      expect(
        migrated
          .prepare('SELECT id, generation_id FROM generation_jobs')
          .all(),
      ).toEqual([{ id: 'job-v1', generation_id: 'generation-v1' }]);

      const index = migrated
        .prepare(
          `SELECT sql FROM sqlite_master
           WHERE type = 'index' AND name = 'generations_client_request_id_unique'`,
        )
        .get() as { sql: string };
      expect(index.sql).toMatch(
        /UNIQUE INDEX[\s\S]+client_request_id[\s\S]+WHERE client_request_id IS NOT NULL/i,
      );
      const insertIdempotent = migrated.prepare(`
        INSERT INTO generations
          (id, session_id, prompt, status, client_request_id, request_hash, created_at, updated_at)
        VALUES (?, 'default-session', 'New intent', 'pending', ?, ?, 'after', 'after')
      `);
      insertIdempotent.run(
        'generation-v2-first',
        '018f6f4d-5c3a-7b8c-9d0e-123456789abc',
        'a'.repeat(64),
      );
      expect(() =>
        insertIdempotent.run(
          'generation-v2-duplicate',
          '018f6f4d-5c3a-7b8c-9d0e-123456789abc',
          'a'.repeat(64),
        ),
      ).toThrow(/UNIQUE constraint failed/);
      migrated
        .prepare("DELETE FROM generations WHERE id = 'generation-v2-first'")
        .run();
      migrated.close();

      const second = runMigration(root, file);
      expect(second).toMatchObject({
        fromVersion: targetVersion,
        toVersion: targetVersion,
        backupPath: null,
        addedColumns: [],
        generations: 1,
      });
    } finally {
      removeSqliteFiles(file);
    }
  });

  it('backfills v2 jobs into durable phases without guessing a missing dispatch outcome', () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(os.tmpdir(), `ai-image-v2-lifecycle-migrate-${Date.now()}.db`);
    const previous = new Database(file);
    initializeTestSchema(previous);
    previous.exec(`
      DROP INDEX generation_jobs_due_idx;
      ALTER TABLE generation_jobs DROP COLUMN retry_started_at;
      ALTER TABLE generation_jobs DROP COLUMN attempt_count;
      ALTER TABLE generation_jobs DROP COLUMN result_snapshot;
      ALTER TABLE generation_jobs DROP COLUMN request_snapshot_version;
      ALTER TABLE generation_jobs DROP COLUMN request_snapshot;
      ALTER TABLE generation_jobs DROP COLUMN phase;
      PRAGMA user_version = 2;
      INSERT INTO generations
        (id, session_id, prompt, status, created_at, updated_at)
      VALUES
        ('gen-terminal', 'default-session', 'done', 'completed', 'before', 'before'),
        ('gen-polling', 'default-session', 'polling', 'pending', 'before', 'before'),
        ('gen-unknown', 'default-session', 'unknown', 'pending', 'before', 'before'),
        ('gen-cancelling', 'default-session', 'cancel', 'running', 'before', 'before');
      INSERT INTO generation_jobs
        (id, generation_id, provider, model, status, provider_handle, error,
         poll_lease_until, next_poll_at, cancel_requested_at, created_at, updated_at)
      VALUES
        ('job-terminal', 'gen-terminal', 'fal', 'model', 'completed', NULL, NULL,
         NULL, NULL, NULL, 'before', 'before'),
        ('job-polling', 'gen-polling', 'fal', 'model', 'pending', '{"externalId":"p"}', NULL,
         NULL, NULL, NULL, 'before', 'before'),
        ('job-unknown', 'gen-unknown', 'fal', 'model', 'pending', NULL, NULL,
         NULL, NULL, NULL, 'before', 'before'),
        ('job-cancelling', 'gen-cancelling', 'fal', 'model', 'running', '{"externalId":"c"}', NULL,
         NULL, NULL, 'before', 'before', 'before');
    `);
    previous.close();

    try {
      const report = runMigration(root, file);
      expect(report).toMatchObject({
        fromVersion: 2,
        toVersion: targetVersion,
        backupPath: `${file}.pre-migrate-v2-to-v${targetVersion}.bak`,
        addedColumns: [
          'generation_jobs.phase',
          'generation_jobs.request_snapshot',
          'generation_jobs.request_snapshot_version',
          'generation_jobs.result_snapshot',
          'generation_jobs.attempt_count',
          'generation_jobs.retry_started_at',
        ],
        jobPhaseBackfill: {
          terminal: 1,
          polling: 1,
          cancelling: 1,
          outcomeUnknown: 1,
        },
      });

      const migrated = new Database(file);
      expect(
        migrated
          .prepare('SELECT id, status, phase, error, attempt_count FROM generation_jobs ORDER BY id')
          .all(),
      ).toEqual([
        expect.objectContaining({ id: 'job-cancelling', status: 'cancelled', phase: 'cancelling', attempt_count: 0 }),
        expect.objectContaining({ id: 'job-polling', status: 'pending', phase: 'polling', attempt_count: 0 }),
        expect.objectContaining({ id: 'job-terminal', status: 'completed', phase: 'terminal', attempt_count: 0 }),
        expect.objectContaining({
          id: 'job-unknown',
          status: 'failed',
          phase: 'outcome_unknown',
          error: expect.stringContaining('LEGACY_DISPATCH_STATE_UNKNOWN'),
          attempt_count: 0,
        }),
      ]);
      expect(
        migrated
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'generation_jobs_due_idx'")
          .get(),
      ).toEqual({ name: 'generation_jobs_due_idx' });
      migrated.close();

      expect(runMigration(root, file)).toMatchObject({
        fromVersion: targetVersion,
        toVersion: targetVersion,
        backupPath: null,
        addedColumns: [],
      });
    } finally {
      removeSqliteFiles(file);
    }
  });

  it('keeps the target version unset and leaves a readable backup for an invalid schema', () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(os.tmpdir(), `ai-image-invalid-migrate-${Date.now()}.db`);
    const invalid = new Database(file);
    invalid.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO sessions VALUES ('session-1', 'Preserve me', 'now', 'now');
    `);
    invalid.close();

    try {
      const result = runFailedMigration(root, file);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');

      const backupPath = `${file}.pre-migrate-v0-to-v${targetVersion}.bak`;
      expect(fs.existsSync(backupPath)).toBe(true);
      const firstBackup = fs.readFileSync(backupPath);

      const secondFailure = runFailedMigration(root, file);
      expect(secondFailure.status).not.toBe(0);
      expect(fs.readFileSync(backupPath)).toEqual(firstBackup);
      expect(fs.existsSync(`${backupPath}.1`)).toBe(false);

      const unchanged = new Database(file, { readonly: true });
      expect(unchanged.pragma('user_version', { simple: true })).toBe(0);
      expect(unchanged.prepare('SELECT id, title FROM sessions').all()).toEqual([
        { id: 'session-1', title: 'Preserve me' },
      ]);
      unchanged.close();

      const backup = new Database(backupPath, { readonly: true });
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(backup.prepare('SELECT id, title FROM sessions').all()).toEqual([
        { id: 'session-1', title: 'Preserve me' },
      ]);
      backup.close();
    } finally {
      removeSqliteFiles(file);
    }
  });

  it('refuses to repair a forged current version with an invalid same-name index', () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(os.tmpdir(), `ai-image-forged-migrate-${Date.now()}.db`);
    const forged = new Database(file);
    initializeTestSchema(forged);
    forged.exec(`
      DROP INDEX unique_job_index;
      CREATE INDEX unique_job_index ON images("index");
    `);
    forged.close();

    try {
      const result = runFailedMigration(root, file);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('does not match required schema');
      expect(
        fs.existsSync(
          `${file}.pre-migrate-v${targetVersion}-to-v${targetVersion}.bak`,
        ),
      ).toBe(false);

      const unchanged = new Database(file, { readonly: true });
      expect(unchanged.pragma('user_version', { simple: true })).toBe(
        targetVersion,
      );
      const index = (
        unchanged.pragma('index_info(unique_job_index)') as Array<{
          name: string;
        }>
      ).map((column) => column.name);
      expect(index).toEqual(['index']);
      unchanged.close();
    } finally {
      removeSqliteFiles(file);
    }
  });

  it('serializes concurrent migration processes and creates only one backup', async () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(os.tmpdir(), `ai-image-concurrent-migrate-${Date.now()}.db`);
    const previous = new Database(file);
    previous.exec('CREATE TABLE migration_marker (value TEXT NOT NULL)');
    previous.prepare('INSERT INTO migration_marker VALUES (?)').run('preserve-me');
    previous.close();

    try {
      const results = await Promise.all([
        runMigrationAsync(root, file),
        runMigrationAsync(root, file),
      ]);
      expect(results.map((result) => result.status)).toEqual([0, 0]);
      const reports = results.map((result) => JSON.parse(result.stdout));
      expect(reports.map((report) => report.fromVersion).sort()).toEqual([
        0,
        targetVersion,
      ]);
      expect(
        reports.filter((report) => report.backupPath !== null),
      ).toHaveLength(1);
      expect(
        fs.existsSync(`${file}.pre-migrate-v0-to-v${targetVersion}.bak`),
      ).toBe(true);
      expect(
        fs.existsSync(`${file}.pre-migrate-v0-to-v${targetVersion}.bak.1`),
      ).toBe(false);
      expect(fs.existsSync(`${file}.migrate.lock`)).toBe(false);
      expect(fs.existsSync(`${file}.migrate-lock.sqlite`)).toBe(true);

      const migrated = new Database(file);
      migrated.pragma('foreign_keys = ON');
      expect(migrated.prepare('SELECT value FROM migration_marker').get()).toEqual({
        value: 'preserve-me',
      });
      expect(inspectDatabaseCompatibility(drizzle(migrated, { schema })).ready).toBe(
        true,
      );
      migrated.close();
    } finally {
      removeSqliteFiles(file);
    }
  });

  it('recovers after the process holding the migration lock is killed', async () => {
    const root = path.resolve(__dirname, '../..');
    const file = path.join(os.tmpdir(), `ai-image-killed-lock-${Date.now()}.db`);
    const previous = new Database(file);
    previous.exec('CREATE TABLE migration_marker (value TEXT NOT NULL)');
    previous.prepare('INSERT INTO migration_marker VALUES (?)').run('preserve-me');
    previous.close();

    let holder: ReturnType<typeof spawn> | undefined;
    try {
      holder = await startLockHolder(file);
      const locked = runFailedMigration(root, file, {
        MIGRATION_LOCK_TIMEOUT_MS: '100',
      });
      expect(locked.status).not.toBe(0);

      const closed = new Promise<void>((resolve) => {
        holder!.once('close', () => resolve());
      });
      holder.kill('SIGKILL');
      await closed;
      holder = undefined;

      const report = runMigration(root, file);
      expect(report).toMatchObject({
        fromVersion: 0,
        toVersion: targetVersion,
      });
      expect(report.backupPath).toBe(
        `${file}.pre-migrate-v0-to-v${targetVersion}.bak`,
      );

      const migrated = new Database(file);
      migrated.pragma('foreign_keys = ON');
      expect(migrated.prepare('SELECT value FROM migration_marker').get()).toEqual({
        value: 'preserve-me',
      });
      expect(inspectDatabaseCompatibility(drizzle(migrated, { schema })).ready).toBe(
        true,
      );
      migrated.close();
    } finally {
      holder?.kill('SIGKILL');
      removeSqliteFiles(file);
    }
  });
});
