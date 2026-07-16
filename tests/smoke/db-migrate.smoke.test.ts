import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function removeSqliteFiles(file: string) {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
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
      const env = { ...process.env, DATABASE_URL: `file:${file}` };
      const first = JSON.parse(
        execFileSync(process.execPath, ['scripts/migrate-db.mjs'], {
          cwd: root,
          env,
          encoding: 'utf8',
        }),
      ) as { deletedOrphanGenerations: number; generations: number };
      expect(first).toMatchObject({
        deletedOrphanGenerations: 7,
        generations: 1,
      });

      const second = JSON.parse(
        execFileSync(process.execPath, ['scripts/migrate-db.mjs'], {
          cwd: root,
          env,
          encoding: 'utf8',
        }),
      ) as { deletedOrphanGenerations: number; generations: number };
      expect(second).toMatchObject({
        deletedOrphanGenerations: 0,
        generations: 1,
      });

      const migrated = new Database(file);
      expect(migrated.pragma('foreign_key_check')).toEqual([]);
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
});
