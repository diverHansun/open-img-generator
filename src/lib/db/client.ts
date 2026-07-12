import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type DbClient = BetterSQLite3Database<typeof schema>;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return './data/app.db';
  }
  return url.replace(/^file:/, '');
}

export function createDbClient(url: string): DbClient {
  const sqlite = new Database(url);
  return drizzle(sqlite);
}

export const db: DbClient = createDbClient(getDatabaseUrl());
