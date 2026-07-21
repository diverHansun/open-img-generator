import Database from 'better-sqlite3';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type DbClient = BetterSQLite3Database<typeof schema>;

export function getDatabasePath(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return path.resolve('./data/app.db');
  }
  const databasePath = url.replace(/^file:/, '');
  return databasePath === ':memory:' ? databasePath : path.resolve(databasePath);
}

export function getDatabasePathHash(): string {
  return createHash('sha256').update(getDatabasePath()).digest('hex');
}

export function createDbClient(url: string): DbClient {
  const sqlite = new Database(url);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite);
}

export function createLazyDbClient(
  factory: () => DbClient = () => createDbClient(getDatabasePath()),
): DbClient {
  let client: DbClient | undefined;
  return new Proxy({} as DbClient, {
    get(_target, property) {
      client ??= factory();
      const value = Reflect.get(client, property, client);
      return typeof value === 'function' ? value.bind(client) : value;
    },
    set(_target, property, value) {
      client ??= factory();
      return Reflect.set(client, property, value, client);
    },
  });
}

export const db: DbClient = createLazyDbClient();
