import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const scriptDirectory =
  typeof __dirname === 'string'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const schemaManifest = JSON.parse(
  fs.readFileSync(
    path.join(scriptDirectory, '..', 'src', 'lib', 'db', 'schema-manifest.json'),
    'utf8',
  ),
);
const requiredVersion = schemaManifest.version;
const databasePath = (process.env.DATABASE_URL ?? './data/app.db').replace(
  /^file:/,
  '',
);

if (databasePath !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
}

function acquireMigrationLock() {
  if (databasePath === ':memory:') return null;
  const lockPath = `${databasePath}.migrate-lock.sqlite`;
  const timeoutMs = Number(process.env.MIGRATION_LOCK_TIMEOUT_MS ?? 10_000);
  const lockDatabase = new Database(lockPath, { timeout: timeoutMs });
  try {
    lockDatabase.exec(
      'CREATE TABLE IF NOT EXISTS migration_lock (id INTEGER PRIMARY KEY)',
    );
    lockDatabase.exec('BEGIN IMMEDIATE');
    return lockDatabase;
  } catch (error) {
    lockDatabase.close();
    throw error;
  }
}

function releaseMigrationLock(lockDatabase) {
  if (!lockDatabase) return;
  try {
    if (lockDatabase.inTransaction) {
      lockDatabase.exec('ROLLBACK');
    }
  } finally {
    lockDatabase.close();
  }
}

async function main() {
  const migrationLock = acquireMigrationLock();
  let sqlite;

  try {
  const fileExisted =
    databasePath !== ':memory:' && fs.existsSync(databasePath);
  const fileSize = fileExisted ? fs.statSync(databasePath).size : 0;
  sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = OFF');
  sqlite.pragma('busy_timeout = 5000');

  function tableExists(name) {
    return Boolean(
      sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    );
  }

  function quoteIdentifier(identifier) {
    return `"${identifier.replaceAll('"', '""')}"`;
  }

  function columnInfo(table, column) {
    if (!tableExists(table)) return undefined;
    return sqlite
      .pragma(`table_info(${quoteIdentifier(table)})`)
      .find((item) => item.name === column);
  }

  function indexMatches(requiredIndex) {
    const object = sqlite
      .prepare(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
      .get(requiredIndex.name);
    if (!object || object.tbl_name !== requiredIndex.table) return false;
    const listEntry = sqlite
      .pragma(`index_list(${quoteIdentifier(requiredIndex.table)})`)
      .find((item) => item.name === requiredIndex.name);
    if (
      !listEntry ||
      Boolean(listEntry.unique) !== requiredIndex.unique ||
      Boolean(listEntry.partial) !== requiredIndex.partial
    ) {
      return false;
    }
    const columns = sqlite
      .pragma(`index_info(${quoteIdentifier(requiredIndex.name)})`)
      .map((item) => item.name);
    const whereMatch = object.sql?.match(/\bWHERE\b([\s\S]*)$/i);
    const actualWhere = whereMatch?.[1]
      ?.replace(/["`\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const requiredWhere = requiredIndex.where
      ?.replace(/["`\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return (
      columns.length === requiredIndex.columns.length &&
      columns.every((column, index) => column === requiredIndex.columns[index]) &&
      actualWhere === requiredWhere
    );
  }

  function findMissingSchemaObjects() {
    const missingTables = [];
    const missingColumns = [];
    for (const [table, columns] of Object.entries(schemaManifest.tables)) {
      if (!tableExists(table)) {
        missingTables.push(table);
        continue;
      }
      for (const column of columns) {
        if (!columnInfo(table, column)) {
          missingColumns.push(`${table}.${column}`);
        }
      }
    }
    const missingIndexes = schemaManifest.indexes
      .filter((index) => !indexMatches(index))
      .map((index) => index.name);
    return { missingTables, missingColumns, missingIndexes };
  }

  function assertRequiredSchema() {
    const missing = findMissingSchemaObjects();
    if (
      missing.missingTables.length > 0 ||
      missing.missingColumns.length > 0 ||
      missing.missingIndexes.length > 0
    ) {
      throw new Error(
        `Database does not match required schema: ${JSON.stringify(missing)}`,
      );
    }
  }

  function assertForeignKeysValid() {
    const violations = sqlite.pragma('foreign_key_check');
    if (violations.length > 0) {
      throw new Error(
        `Database has ${violations.length} foreign-key violation(s)`,
      );
    }
  }

  function createLatestSchema() {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generations (
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
      CREATE TABLE IF NOT EXISTS generation_jobs (
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
      CREATE TABLE IF NOT EXISTS images (
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
      CREATE TABLE IF NOT EXISTS videos (
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
    `);
    createAncillarySchema();
  }

  function createAncillarySchema() {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_preferences (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(provider, model)
      );
      CREATE INDEX IF NOT EXISTS projects_updated_at_idx ON projects(updated_at);
      CREATE INDEX IF NOT EXISTS sessions_project_updated_at_idx ON sessions(project_id, updated_at);
      CREATE INDEX IF NOT EXISTS generations_session_created_at_idx ON generations(session_id, created_at);
      CREATE INDEX IF NOT EXISTS generations_created_at_idx ON generations(created_at);
      CREATE INDEX IF NOT EXISTS generation_jobs_generation_idx ON generation_jobs(generation_id);
      CREATE UNIQUE INDEX IF NOT EXISTS unique_job_index ON images(generation_job_id, "index");
      CREATE UNIQUE INDEX IF NOT EXISTS favorites_image_unique ON favorites(image_id);
      CREATE INDEX IF NOT EXISTS favorites_created_at_idx ON favorites(created_at);
    `);
  }

  function createLifecycleIndexes() {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS generation_jobs_due_idx
        ON generation_jobs(phase, next_poll_at, poll_lease_until, updated_at, id);
    `);
  }

  function migrateLegacySchema() {
    const sessionCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM sessions')
      .get().count;
    const orphanCount = sqlite
      .prepare(
        `SELECT COUNT(*) AS count
         FROM generations g
         LEFT JOIN sessions s ON s.id = g.session_id
         WHERE s.id IS NULL`,
      )
      .get().count;

    sqlite.exec(`
      CREATE TABLE projects_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects_new(id),
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE generations_new (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions_new(id),
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE generation_jobs_new (
        id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL REFERENCES generations_new(id) ON DELETE CASCADE,
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
      CREATE TABLE images_new (
        id TEXT PRIMARY KEY,
        generation_job_id TEXT NOT NULL REFERENCES generation_jobs_new(id) ON DELETE CASCADE,
        "index" INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        content_type TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        size_bytes INTEGER,
        created_at TEXT NOT NULL
      );
    `);

    if (sessionCount > 0) {
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `INSERT INTO projects_new (id, title, created_at, updated_at)
           VALUES ('__migrated_project__', 'Migrated project', ?, ?)`,
        )
        .run(now, now);
      sqlite.exec(`
        INSERT INTO sessions_new (id, project_id, title, created_at, updated_at)
        SELECT id, '__migrated_project__', title, created_at, updated_at FROM sessions;
      `);
    }

    const leaseColumn = columnInfo('generation_jobs', 'poll_lease_until')
      ? 'j.poll_lease_until'
      : 'NULL';
    const nextPollColumn = columnInfo('generation_jobs', 'next_poll_at')
      ? 'j.next_poll_at'
      : 'NULL';
    const cancelRequestedColumn = columnInfo(
      'generation_jobs',
      'cancel_requested_at',
    )
      ? 'j.cancel_requested_at'
      : 'NULL';

    sqlite.exec(`
      INSERT INTO generations_new
      SELECT g.* FROM generations g
      INNER JOIN sessions_new s ON s.id = g.session_id;

      INSERT INTO generation_jobs_new
        (id, generation_id, provider, model, status, provider_handle, error, poll_lease_until, next_poll_at, cancel_requested_at, created_at, updated_at)
      SELECT j.id, j.generation_id, j.provider, j.model, j.status,
             j.provider_handle, j.error, ${leaseColumn}, ${nextPollColumn}, ${cancelRequestedColumn}, j.created_at, j.updated_at
      FROM generation_jobs j
      INNER JOIN generations_new g ON g.id = j.generation_id;

      INSERT INTO images_new
      SELECT i.* FROM images i
      INNER JOIN generation_jobs_new j ON j.id = i.generation_job_id;

      DROP TABLE images;
      DROP TABLE generation_jobs;
      DROP TABLE generations;
      DROP TABLE sessions;

      ALTER TABLE projects_new RENAME TO projects;
      ALTER TABLE sessions_new RENAME TO sessions;
      ALTER TABLE generations_new RENAME TO generations;
      ALTER TABLE generation_jobs_new RENAME TO generation_jobs;
      ALTER TABLE images_new RENAME TO images;
    `);
    createAncillarySchema();
    return orphanCount;
  }

  let deletedOrphanGenerations = 0;
  const addedColumns = [];
  const jobPhaseBackfill = {
    terminal: 0,
    polling: 0,
    cancelling: 0,
    outcomeUnknown: 0,
  };
  const migrations = new Map([
    [
      0,
      {
        to: 1,
        up() {
          if (!tableExists('sessions')) {
            createLatestSchema();
            return;
          }
          const projectId = columnInfo('sessions', 'project_id');
          const generationSessionId = columnInfo('generations', 'session_id');
          const isProjectSchema =
            tableExists('projects') &&
            projectId?.notnull === 1 &&
            generationSessionId?.notnull === 1;

          if (!isProjectSchema) {
            deletedOrphanGenerations = migrateLegacySchema();
            return;
          }

          createAncillarySchema();
          for (const column of [
            'poll_lease_until',
            'next_poll_at',
            'cancel_requested_at',
          ]) {
            if (!columnInfo('generation_jobs', column)) {
              sqlite.exec(
                `ALTER TABLE generation_jobs ADD COLUMN ${quoteIdentifier(column)} TEXT`,
              );
              addedColumns.push(`generation_jobs.${column}`);
            }
          }
        },
      },
    ],
    [
      1,
      {
        to: 2,
        up() {
          for (const column of ['client_request_id', 'request_hash']) {
            if (!columnInfo('generations', column)) {
              sqlite.exec(
                `ALTER TABLE generations ADD COLUMN ${quoteIdentifier(column)} TEXT`,
              );
              addedColumns.push(`generations.${column}`);
            }
          }
          sqlite.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS generations_client_request_id_unique
              ON generations(client_request_id)
              WHERE client_request_id IS NOT NULL
          `);
        },
      },
    ],
    [
      2,
      {
        to: 3,
        up() {
          const lifecycleColumns = [
            ['phase', "TEXT NOT NULL DEFAULT 'queued'"],
            ['request_snapshot', 'TEXT'],
            ['request_snapshot_version', 'INTEGER'],
            ['result_snapshot', 'TEXT'],
            ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
            ['retry_started_at', 'TEXT'],
          ];
          for (const [column, definition] of lifecycleColumns) {
            if (!columnInfo('generation_jobs', column)) {
              sqlite.exec(
                `ALTER TABLE generation_jobs ADD COLUMN ${quoteIdentifier(column)} ${definition}`,
              );
              addedColumns.push(`generation_jobs.${column}`);
            }
          }

          const terminalStatuses = "'completed', 'failed', 'cancelled'";
          jobPhaseBackfill.terminal = sqlite
            .prepare(
              `SELECT COUNT(*) AS count FROM generation_jobs
               WHERE status IN (${terminalStatuses})`,
            )
            .get().count;
          sqlite.exec(`
            UPDATE generation_jobs
            SET phase = 'terminal',
                poll_lease_until = NULL,
                next_poll_at = NULL
            WHERE status IN (${terminalStatuses});
          `);

          // A legacy cancel marker is already the user's durable decision. Do
          // not resume polling it after upgrade; a known handle can still be
          // handed to the cancelling phase by the worker.
          jobPhaseBackfill.cancelling = sqlite
            .prepare(
              `SELECT COUNT(*) AS count FROM generation_jobs
               WHERE status IN ('pending', 'running')
                 AND cancel_requested_at IS NOT NULL`,
            )
            .get().count;
          const migrationNow = new Date().toISOString();
          sqlite.prepare(`
            UPDATE generation_jobs
            SET status = 'cancelled',
                phase = CASE
                  WHEN provider_handle IS NULL THEN 'terminal'
                  ELSE 'cancelling'
                END,
                poll_lease_until = NULL,
                next_poll_at = CASE
                  WHEN provider_handle IS NULL THEN NULL
                  ELSE ?
                END,
                updated_at = ?
            WHERE status IN ('pending', 'running')
              AND cancel_requested_at IS NOT NULL
          `).run(migrationNow, migrationNow);

          jobPhaseBackfill.polling = sqlite
            .prepare(
              `SELECT COUNT(*) AS count FROM generation_jobs
               WHERE status IN ('pending', 'running')
                 AND cancel_requested_at IS NULL
                 AND provider_handle IS NOT NULL`,
            )
            .get().count;
          sqlite.exec(`
            UPDATE generation_jobs
            SET phase = 'polling'
            WHERE status IN ('pending', 'running')
              AND cancel_requested_at IS NULL
              AND provider_handle IS NOT NULL;
          `);

          jobPhaseBackfill.outcomeUnknown = sqlite
            .prepare(
              `SELECT COUNT(*) AS count FROM generation_jobs
               WHERE status NOT IN (${terminalStatuses})
                 AND cancel_requested_at IS NULL
                 AND provider_handle IS NULL`,
            )
            .get().count;
          sqlite.prepare(`
            UPDATE generation_jobs
            SET status = 'failed',
                phase = 'outcome_unknown',
                error = ?,
                poll_lease_until = NULL,
                next_poll_at = NULL,
                updated_at = ?
            WHERE status NOT IN (${terminalStatuses})
              AND cancel_requested_at IS NULL
              AND provider_handle IS NULL
          `).run(
            JSON.stringify({
              code: 'LEGACY_DISPATCH_STATE_UNKNOWN',
              message: 'Legacy job had no recoverable provider handle',
              retryable: false,
            }),
            migrationNow,
          );

          // Keep public aggregates consistent with backfilled terminal and
          // unknown jobs. A Generation with no jobs is left untouched because
          // historical imports may legitimately have no recoverable detail.
          sqlite.prepare(`
            UPDATE generations
            SET status = CASE
              WHEN EXISTS (
                SELECT 1 FROM generation_jobs j
                WHERE j.generation_id = generations.id AND j.status = 'running'
              ) THEN 'running'
              WHEN EXISTS (
                SELECT 1 FROM generation_jobs j
                WHERE j.generation_id = generations.id AND j.status = 'pending'
              ) THEN 'pending'
              WHEN EXISTS (
                SELECT 1 FROM generation_jobs j
                WHERE j.generation_id = generations.id AND j.status = 'completed'
              ) THEN 'completed'
              WHEN EXISTS (
                SELECT 1 FROM generation_jobs j
                WHERE j.generation_id = generations.id AND j.status = 'cancelled'
              ) THEN 'cancelled'
              ELSE 'failed'
            END,
            updated_at = ?
            WHERE EXISTS (
              SELECT 1 FROM generation_jobs j WHERE j.generation_id = generations.id
            )
          `).run(migrationNow);

          createLifecycleIndexes();
        },
      },
    ],
    [
      3,
      {
        to: 4,
        up() {
          sqlite.exec(`
            CREATE TABLE images_v4 (
              id TEXT PRIMARY KEY,
              generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
              "index" INTEGER NOT NULL,
              storage_path TEXT,
              content_type TEXT NOT NULL,
              width INTEGER,
              height INTEGER,
              size_bytes INTEGER,
              created_at TEXT NOT NULL,
              removed_at TEXT,
              removal_reason TEXT,
              CHECK (
                (storage_path IS NOT NULL AND removed_at IS NULL AND removal_reason IS NULL)
                OR
                (storage_path IS NULL AND removed_at IS NOT NULL AND
                  removal_reason IN ('retention_expired', 'user_deleted', 'storage_missing'))
              )
            );
            INSERT INTO images_v4
              (id, generation_job_id, "index", storage_path, content_type,
               width, height, size_bytes, created_at, removed_at, removal_reason)
            SELECT id, generation_job_id, "index", storage_path, content_type,
                   width, height, size_bytes, created_at, NULL, NULL
            FROM images;
            DROP TABLE images;
            ALTER TABLE images_v4 RENAME TO images;
            CREATE UNIQUE INDEX unique_job_index
              ON images(generation_job_id, "index");
          `);
        },
      },
    ],
    [
      4,
      {
        to: 5,
        up() {
          if (!columnInfo('generations', 'media_kind')) {
            sqlite.exec("ALTER TABLE generations ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'image'");
            addedColumns.push('generations.media_kind');
          }
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS videos (
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
            CREATE UNIQUE INDEX IF NOT EXISTS unique_video_job_index
              ON videos(generation_job_id, "index");
          `);
        },
      },
    ],
    [
      5,
      {
        to: 6,
        up() {
          sqlite.exec(`
            CREATE TABLE images_v6 (
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
            INSERT INTO images_v6
              (id, generation_job_id, "index", source_kind, storage_path,
               remote_url, remote_expires_at, content_type, width, height,
               size_bytes, created_at, removed_at, removal_reason)
            SELECT id, generation_job_id, "index", 'managed', storage_path,
                   NULL, NULL, content_type, width, height, size_bytes,
                   created_at, removed_at, removal_reason
            FROM images;
            DROP TABLE images;
            ALTER TABLE images_v6 RENAME TO images;
            CREATE UNIQUE INDEX unique_job_index
              ON images(generation_job_id, "index");
          `);
        },
      },
    ],
  ]);

  function validateExistingBackup(backupPath, expectedVersion) {
    const backup = new Database(backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (backup.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error('Existing migration backup failed integrity_check');
      }
      const backupVersion = Number(
        backup.pragma('user_version', { simple: true }),
      );
      if (backupVersion !== expectedVersion) {
        throw new Error(
          `Existing migration backup has schema version ${backupVersion}, expected ${expectedVersion}`,
        );
      }
    } finally {
      backup.close();
    }
  }

  async function ensureVersionedBackup(fromVersion) {
    if (!fileExisted || fileSize === 0 || databasePath === ':memory:') {
      return null;
    }
    const backupPath = `${databasePath}.pre-migrate-v${fromVersion}-to-v${requiredVersion}.bak`;
    if (fs.existsSync(backupPath)) {
      validateExistingBackup(backupPath, fromVersion);
      return backupPath;
    }
    await sqlite.backup(backupPath);
    validateExistingBackup(backupPath, fromVersion);
    return backupPath;
  }

  const fromVersion = Number(
    sqlite.pragma('user_version', { simple: true }),
  );
  if (fromVersion > requiredVersion) {
    throw new Error(
      `Database schema version ${fromVersion} is newer than supported version ${requiredVersion}`,
    );
  }

  let backupPath = null;
  if (fromVersion < requiredVersion) {
    backupPath = await ensureVersionedBackup(fromVersion);
    const runMigrations = sqlite.transaction(() => {
      let currentVersion = fromVersion;
      while (currentVersion < requiredVersion) {
        const migration = migrations.get(currentVersion);
        if (!migration || migration.to <= currentVersion) {
          throw new Error(
            `No ordered migration from schema version ${currentVersion}`,
          );
        }
        migration.up();
        currentVersion = migration.to;
        sqlite.pragma(`user_version = ${currentVersion}`);
      }
      assertRequiredSchema();
      assertForeignKeysValid();
    });
    runMigrations.immediate();
  } else {
    assertRequiredSchema();
    assertForeignKeysValid();
  }

  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  assertForeignKeysValid();

  const result = {
    databasePath,
    fromVersion,
    toVersion: Number(sqlite.pragma('user_version', { simple: true })),
    backupPath,
    addedColumns,
    deletedOrphanGenerations,
    jobPhaseBackfill,
    projects: sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get().count,
    sessions: sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
    generations: sqlite
      .prepare('SELECT COUNT(*) AS count FROM generations')
      .get().count,
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    sqlite?.close();
    releaseMigrationLock(migrationLock);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
