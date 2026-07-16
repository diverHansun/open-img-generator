import Database from 'better-sqlite3';

const databasePath = (process.env.DATABASE_URL ?? './data/app.db').replace(/^file:/, '');
const sqlite = new Database(databasePath);

sqlite.pragma('foreign_keys = OFF');
sqlite.pragma('busy_timeout = 5000');

function tableExists(name) {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function columnInfo(table, column) {
  if (!tableExists(table)) return undefined;
  return sqlite.pragma(`table_info(${table})`).find((item) => item.name === column);
}

function createLatestSchema() {
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

function migrateLegacySchema() {
  const sessionCount = sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
  const orphanCount = sqlite
    .prepare(
      `SELECT COUNT(*) AS count
       FROM generations g
       LEFT JOIN sessions s ON s.id = g.session_id
       WHERE s.id IS NULL`,
    )
    .get().count;

  sqlite.transaction(() => {
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
      sqlite
        .prepare(
          `INSERT INTO projects_new (id, title, created_at, updated_at)
           VALUES ('__migrated_project__', 'Migrated project', ?, ?)`,
        )
        .run(new Date().toISOString(), new Date().toISOString());
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
    const cancelRequestedColumn = columnInfo('generation_jobs', 'cancel_requested_at')
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
  })();

  return orphanCount;
}

let deletedOrphanGenerations = 0;
if (!tableExists('sessions')) {
  createLatestSchema();
} else {
  const projectId = columnInfo('sessions', 'project_id');
  const generationSessionId = columnInfo('generations', 'session_id');
  const isLatest =
    tableExists('projects') &&
    projectId?.notnull === 1 &&
    generationSessionId?.notnull === 1;
  if (isLatest) {
    createAncillarySchema();
    for (const column of ['poll_lease_until', 'next_poll_at', 'cancel_requested_at']) {
      if (!columnInfo('generation_jobs', column)) {
        sqlite.exec(`ALTER TABLE generation_jobs ADD COLUMN ${column} TEXT`);
      }
    }
  } else {
    deletedOrphanGenerations = migrateLegacySchema();
  }
}

sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');
const foreignKeyViolations = sqlite.pragma('foreign_key_check');
if (foreignKeyViolations.length > 0) {
  throw new Error(`Migration left ${foreignKeyViolations.length} foreign-key violation(s)`);
}
const result = {
  databasePath,
  deletedOrphanGenerations,
  projects: sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get().count,
  sessions: sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
  generations: sqlite.prepare('SELECT COUNT(*) AS count FROM generations').get().count,
};
sqlite.close();

process.stdout.write(`${JSON.stringify(result)}\n`);
