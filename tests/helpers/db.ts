import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../src/lib/db/schema';
import { initializeTestSchema } from './db-schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  initializeTestSchema(sqlite);
  return { db, sqlite };
}

export type TestDb = ReturnType<typeof createTestDb>;
