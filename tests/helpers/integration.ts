import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export function createIntegrationDb() {
  const tempFile = path.join(os.tmpdir(), `ai-image-test-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${tempFile}`;

  const sqlite = new Database(tempFile);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE generation_jobs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL REFERENCES generations(id),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_handle TEXT,
      error TEXT,
      poll_lease_until TEXT,
      next_poll_at TEXT,
      cancel_requested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id),
      "index" INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      content_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX unique_job_index ON images(generation_job_id, "index");
    CREATE TABLE favorites (
      id TEXT PRIMARY KEY,
      image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX favorites_image_unique ON favorites(image_id);
    CREATE TABLE model_preferences (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(provider, model)
    );
    INSERT INTO projects VALUES ('default-project', 'Test Project', 'now', 'now');
    INSERT INTO sessions VALUES ('default-session', 'default-project', 'Test Session', 'now', 'now');
  `);
  sqlite.close();

  return {
    tempFile,
    cleanup: () => {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // ignore
      }
    },
  };
}

export function createStorageDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-int-'));
  process.env.LOCAL_STORAGE_DIR = tempDir;
  return {
    tempDir,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
