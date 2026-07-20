import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { inspectDatabaseCompatibility } from '../../src/lib/db/compatibility';
import * as schema from '../../src/lib/db/schema';
import { initializeTestSchema } from '../helpers/db-schema';

function removeSqliteFiles(file: string) {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
  fs.rmSync(`${file}.pre-migrate-v0-to-v1.bak`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v0-to-v1.bak.1`, { force: true });
  fs.rmSync(`${file}.pre-migrate-v1-to-v1.bak`, { force: true });
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
        toVersion: 1,
        deletedOrphanGenerations: 7,
        generations: 1,
      });
      expect(first.backupPath).toBe(`${file}.pre-migrate-v0-to-v1.bak`);
      expect(fs.existsSync(first.backupPath!)).toBe(true);

      const second = runMigration(root, file);
      expect(second).toMatchObject({
        fromVersion: 1,
        toVersion: 1,
        backupPath: null,
        deletedOrphanGenerations: 0,
        generations: 1,
      });

      const migrated = new Database(file);
      migrated.pragma('foreign_keys = ON');
      expect(migrated.pragma('user_version', { simple: true })).toBe(1);
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
        toVersion: 1,
        addedColumns: [
          'generation_jobs.next_poll_at',
          'generation_jobs.cancel_requested_at',
        ],
        deletedOrphanGenerations: 0,
        generations: 1,
      });
      expect(first.backupPath).toBe(`${file}.pre-migrate-v0-to-v1.bak`);
      expect(fs.existsSync(first.backupPath!)).toBe(true);

      const migrated = new Database(file);
      expect(migrated.pragma('user_version', { simple: true })).toBe(1);
      expect(migrated.pragma('foreign_key_check')).toEqual([]);
      expect(
        migrated.prepare('SELECT id, prompt, status FROM generations').all(),
      ).toEqual([
        { id: 'generation-1', prompt: 'Preserve me', status: 'pending' },
      ]);
      expect(
        migrated.prepare('SELECT id, generation_id, provider_handle FROM generation_jobs').all(),
      ).toEqual([
        { id: 'job-1', generation_id: 'generation-1', provider_handle: null },
      ]);
      const jobColumns = migrated.pragma('table_info(generation_jobs)') as Array<{ name: string }>;
      expect(jobColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['next_poll_at', 'cancel_requested_at']),
      );
      migrated.close();

      const second = runMigration(root, file);
      expect(second).toMatchObject({
        fromVersion: 1,
        toVersion: 1,
        backupPath: null,
        addedColumns: [],
        generations: 1,
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

      const backupPath = `${file}.pre-migrate-v0-to-v1.bak`;
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
      expect(fs.existsSync(`${file}.pre-migrate-v1-to-v1.bak`)).toBe(false);

      const unchanged = new Database(file, { readonly: true });
      expect(unchanged.pragma('user_version', { simple: true })).toBe(1);
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
      expect(reports.map((report) => report.fromVersion).sort()).toEqual([0, 1]);
      expect(
        reports.filter((report) => report.backupPath !== null),
      ).toHaveLength(1);
      expect(fs.existsSync(`${file}.pre-migrate-v0-to-v1.bak`)).toBe(true);
      expect(fs.existsSync(`${file}.pre-migrate-v0-to-v1.bak.1`)).toBe(false);
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
      expect(report).toMatchObject({ fromVersion: 0, toVersion: 1 });
      expect(report.backupPath).toBe(`${file}.pre-migrate-v0-to-v1.bak`);

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
