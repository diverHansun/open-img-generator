import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getRuntimePaths } from '../runtime-paths';
import * as schema from './schema';

export type DbClient = BetterSQLite3Database<typeof schema>;
type ClosableDbClient = DbClient & { $client?: { close(): void } };
const lazyClientClosers = new WeakMap<object, () => void>();

export function getDatabasePath(): string {
  return getRuntimePaths().databasePath;
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
  const proxy = new Proxy({} as DbClient, {
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
  lazyClientClosers.set(proxy, () => {
    (client as ClosableDbClient | undefined)?.$client?.close();
    client = undefined;
  });
  return proxy;
}

export const db: DbClient = createLazyDbClient();

export function closeDbClient(client: DbClient = db): void {
  const closeLazyClient = lazyClientClosers.get(client);
  if (closeLazyClient) {
    closeLazyClient();
    return;
  }
  (client as ClosableDbClient).$client?.close();
}
