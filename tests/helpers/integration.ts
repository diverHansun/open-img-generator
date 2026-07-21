import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initializeTestSchema } from './db-schema';

export function createIntegrationDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-image-db-int-'));
  const tempFile = path.join(tempDir, 'app.sqlite');
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${tempFile}`;

  const sqlite = new Database(tempFile);
  sqlite.pragma('foreign_keys = ON');
  initializeTestSchema(sqlite);
  sqlite.close();

  return {
    tempFile,
    tempDir,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    },
  };
}

export function createStorageDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-int-'));
  const originalStorageDir = process.env.LOCAL_STORAGE_DIR;
  process.env.LOCAL_STORAGE_DIR = tempDir;
  return {
    tempDir,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (originalStorageDir === undefined) delete process.env.LOCAL_STORAGE_DIR;
      else process.env.LOCAL_STORAGE_DIR = originalStorageDir;
    },
  };
}

/** Preferred helper for storage-aware integration tests: DB/root never drift. */
export function createIntegrationRuntime() {
  const database = createIntegrationDb();
  const storage = createStorageDir();
  return {
    database,
    storage,
    cleanup: () => {
      storage.cleanup();
      database.cleanup();
    },
  };
}
