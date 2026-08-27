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
      media_kind TEXT NOT NULL DEFAULT 'image',
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
      phase TEXT NOT NULL DEFAULT 'queued',
      request_snapshot TEXT,
      request_snapshot_version INTEGER,
      result_snapshot TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_started_at TEXT,
      poll_lease_until TEXT,
      next_poll_at TEXT,
      cancel_requested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX generation_jobs_generation_idx ON generation_jobs(generation_id);
    CREATE INDEX generation_jobs_due_idx
      ON generation_jobs(phase, next_poll_at, poll_lease_until, updated_at, id);
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
      "index" INTEGER NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'managed',
      storage_path TEXT,
      remote_url TEXT,
      remote_expires_at TEXT,
      content_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      created_at TEXT NOT NULL,
      removed_at TEXT,
      removal_reason TEXT,
      CHECK (
        (source_kind = 'managed' AND storage_path IS NOT NULL AND remote_url IS NULL AND
          remote_expires_at IS NULL AND removed_at IS NULL AND removal_reason IS NULL)
        OR
        (source_kind = 'remote' AND storage_path IS NULL AND remote_url IS NOT NULL AND
          removed_at IS NULL AND removal_reason IS NULL)
        OR
        (storage_path IS NULL AND remote_url IS NULL AND remote_expires_at IS NULL AND
          removed_at IS NOT NULL AND
          removal_reason IN ('retention_expired', 'remote_expired', 'user_deleted', 'storage_missing'))
      )
    );
    CREATE UNIQUE INDEX unique_job_index ON images(generation_job_id, "index");
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
      "index" INTEGER NOT NULL,
      storage_path TEXT,
      content_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_seconds INTEGER,
      size_bytes INTEGER,
      created_at TEXT NOT NULL,
      removed_at TEXT,
      removal_reason TEXT
    );
    CREATE UNIQUE INDEX unique_video_job_index ON videos(generation_job_id, "index");
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
