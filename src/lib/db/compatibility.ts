import {
  DatabaseUnavailableError,
  SchemaNotReadyError,
} from '../errors';
import type { DbClient } from './client';
import schemaManifest from './schema-manifest.json';

type SchemaManifest = {
  version: number;
  tables: Record<string, string[]>;
  indexes: Array<{
    name: string;
    table: string;
    columns: string[];
    unique: boolean;
    partial: boolean;
  }>;
};

const manifest = schemaManifest as SchemaManifest;

export const REQUIRED_DATABASE_SCHEMA_VERSION = manifest.version;

export type DatabaseCompatibilityReport = {
  ready: boolean;
  currentVersion: number;
  requiredVersion: number;
  foreignKeysEnabled: boolean;
  missingTables: string[];
  missingColumns: string[];
  missingIndexes: string[];
};

type PragmaVersionRow = { user_version: number };
type PragmaForeignKeysRow = { foreign_keys: number };
type NamedObjectRow = { name: string };
type IndexObjectRow = { name: string; tbl_name: string };
type IndexListRow = { name: string; unique: number; partial: number };

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function inspectDatabaseCompatibility(
  client: DbClient,
): DatabaseCompatibilityReport {
  const versionRows = client.all<PragmaVersionRow>('PRAGMA user_version');
  const foreignKeyRows = client.all<PragmaForeignKeysRow>('PRAGMA foreign_keys');
  const tableNames = new Set(
    client
      .all<NamedObjectRow>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
      .map((row) => row.name),
  );
  const indexObjects = new Map(
    client
      .all<IndexObjectRow>(
        "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'",
      )
      .map((row) => [row.name, row] as const),
  );

  const missingTables: string[] = [];
  const missingColumns: string[] = [];

  for (const [table, requiredColumns] of Object.entries(manifest.tables)) {
    if (!tableNames.has(table)) {
      missingTables.push(table);
      continue;
    }
    const columns = new Set(
      client
        .all<NamedObjectRow>(`PRAGMA table_info(${quoteIdentifier(table)})`)
        .map((row) => row.name),
    );
    for (const column of requiredColumns) {
      if (!columns.has(column)) {
        missingColumns.push(`${table}.${column}`);
      }
    }
  }

  const missingIndexes = manifest.indexes
    .filter((requiredIndex) => {
      const object = indexObjects.get(requiredIndex.name);
      if (!object || object.tbl_name !== requiredIndex.table) return true;
      const listEntry = client
        .all<IndexListRow>(
          `PRAGMA index_list(${quoteIdentifier(requiredIndex.table)})`,
        )
        .find((row) => row.name === requiredIndex.name);
      if (
        !listEntry ||
        Boolean(listEntry.unique) !== requiredIndex.unique ||
        Boolean(listEntry.partial) !== requiredIndex.partial
      ) {
        return true;
      }
      const columns = client
        .all<NamedObjectRow>(
          `PRAGMA index_info(${quoteIdentifier(requiredIndex.name)})`,
        )
        .map((row) => row.name);
      return (
        columns.length !== requiredIndex.columns.length ||
        columns.some((column, index) => column !== requiredIndex.columns[index])
      );
    })
    .map((index) => index.name);
  const currentVersion = versionRows[0]?.user_version ?? 0;
  const foreignKeysEnabled = foreignKeyRows[0]?.foreign_keys === 1;
  const ready =
    currentVersion === REQUIRED_DATABASE_SCHEMA_VERSION &&
    foreignKeysEnabled &&
    missingTables.length === 0 &&
    missingColumns.length === 0 &&
    missingIndexes.length === 0;

  return {
    ready,
    currentVersion,
    requiredVersion: REQUIRED_DATABASE_SCHEMA_VERSION,
    foreignKeysEnabled,
    missingTables,
    missingColumns,
    missingIndexes,
  };
}

export function assertDatabaseReady(
  client: DbClient,
): DatabaseCompatibilityReport {
  let report: DatabaseCompatibilityReport;
  try {
    report = inspectDatabaseCompatibility(client);
  } catch (cause) {
    throw new DatabaseUnavailableError(cause);
  }
  if (!report.ready) {
    throw new SchemaNotReadyError(report);
  }
  return report;
}
