import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../../../tests/helpers/db';
import {
  REQUIRED_DATABASE_SCHEMA_VERSION,
  inspectDatabaseCompatibility,
} from './compatibility';

describe('database schema compatibility', () => {
  let testDb: TestDb | undefined;

  afterEach(() => {
    testDb?.sqlite.close();
    testDb = undefined;
  });

  it('reports ready only when version, required objects, and foreign keys match', () => {
    testDb = createTestDb();
    testDb.sqlite.pragma(`user_version = ${REQUIRED_DATABASE_SCHEMA_VERSION}`);

    expect(inspectDatabaseCompatibility(testDb.db)).toMatchObject({
      ready: true,
      currentVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      requiredVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      foreignKeysEnabled: true,
      missingTables: [],
      missingColumns: [],
      missingIndexes: [],
    });
  });

  it('rejects a version number that claims ready while a required index is missing', () => {
    testDb = createTestDb();
    testDb.sqlite.pragma(`user_version = ${REQUIRED_DATABASE_SCHEMA_VERSION}`);
    testDb.sqlite.exec('DROP INDEX unique_job_index');

    expect(inspectDatabaseCompatibility(testDb.db)).toMatchObject({
      ready: false,
      currentVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      missingIndexes: ['unique_job_index'],
    });
  });

  it('rejects a same-name index whose uniqueness or columns do not match', () => {
    testDb = createTestDb();
    testDb.sqlite.exec(`
      DROP INDEX unique_job_index;
      CREATE INDEX unique_job_index ON images("index");
    `);

    expect(inspectDatabaseCompatibility(testDb.db)).toMatchObject({
      ready: false,
      currentVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      missingIndexes: ['unique_job_index'],
    });
  });

  it('rejects a partial unique index with the wrong predicate', () => {
    testDb = createTestDb();
    testDb.sqlite.exec(`
      DROP INDEX generations_client_request_id_unique;
      CREATE UNIQUE INDEX generations_client_request_id_unique
        ON generations(client_request_id)
        WHERE client_request_id = 'only-this-key';
    `);

    expect(inspectDatabaseCompatibility(testDb.db)).toMatchObject({
      ready: false,
      currentVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      missingIndexes: ['generations_client_request_id_unique'],
    });
  });

  it('rejects a current version whose required column is missing', () => {
    testDb = createTestDb();
    testDb.sqlite.exec(`
      DROP INDEX generation_jobs_due_idx;
      ALTER TABLE generation_jobs DROP COLUMN next_poll_at;
    `);

    expect(inspectDatabaseCompatibility(testDb.db)).toMatchObject({
      ready: false,
      currentVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      missingColumns: ['generation_jobs.next_poll_at'],
    });
  });

  it('rejects a current version whose lifecycle due index is missing', () => {
    testDb = createTestDb();
    testDb.sqlite.exec('DROP INDEX generation_jobs_due_idx');

    expect(inspectDatabaseCompatibility(testDb.db)).toMatchObject({
      ready: false,
      currentVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      missingIndexes: ['generation_jobs_due_idx'],
    });
  });

  it('rejects a connectable latest-shaped database whose version is stale', () => {
    testDb = createTestDb();
    testDb.sqlite.pragma('user_version = 0');

    expect(inspectDatabaseCompatibility(testDb.db)).toMatchObject({
      ready: false,
      currentVersion: 0,
      requiredVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
      missingTables: [],
      missingColumns: [],
      missingIndexes: [],
    });
  });
});
