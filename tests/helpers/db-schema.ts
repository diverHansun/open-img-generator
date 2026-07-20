import type Database from 'better-sqlite3';
import schemaManifest from '../../src/lib/db/schema-manifest.json';

/**
 * Minimal schema shared by isolated unit repositories and file-backed integration tests.
 * Keep this in sync with src/lib/db/schema.ts; test helpers deliberately avoid the
 * application DB singleton so each test file owns its data lifecycle.
 */
export function initializeTestSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX projects_updated_at_idx ON projects(updated_at);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX sessions_project_updated_at_idx ON sessions(project_id, updated_at);
    CREATE TABLE generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      client_request_id TEXT,
      request_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX generations_session_created_at_idx ON generations(session_id, created_at);
    CREATE INDEX generations_created_at_idx ON generations(created_at);
    CREATE UNIQUE INDEX generations_client_request_id_unique
      ON generations(client_request_id)
      WHERE client_request_id IS NOT NULL;
    CREATE TABLE generation_jobs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
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
    CREATE INDEX generation_jobs_generation_idx ON generation_jobs(generation_id);
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
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
    CREATE INDEX favorites_created_at_idx ON favorites(created_at);
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
  sqlite.pragma(`user_version = ${schemaManifest.version}`);
}
