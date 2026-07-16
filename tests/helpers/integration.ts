import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export function createIntegrationDb() {
  const tempFile = path.join(os.tmpdir(), `ai-image-test-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${tempFile}`;

  const sqlite = new Database(tempFile);
  sqlite.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE generations (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
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
