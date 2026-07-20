import { NextResponse } from 'next/server';
import { listEnabled } from '../../../lib/providers';
import { db, inspectDatabaseCompatibility } from '../../../lib/db';
import { ensureWorkerStarted } from '../../../lib/job-engine';

export function GET() {
  let schema: ReturnType<typeof inspectDatabaseCompatibility>;
  try {
    schema = inspectDatabaseCompatibility(db);
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        enabledProviders: [],
        db: 'error',
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database is unavailable',
          retryable: true,
        },
      },
      { status: 503 },
    );
  }

  if (!schema.ready) {
    return NextResponse.json(
      {
        status: 'error',
        enabledProviders: [],
        db: 'error',
        schema,
        error: {
          code: 'SCHEMA_NOT_READY',
          message: 'Database schema is not ready',
          retryable: false,
          details: {
            currentVersion: schema.currentVersion,
            requiredVersion: schema.requiredVersion,
            foreignKeysEnabled: schema.foreignKeysEnabled,
            missingTables: schema.missingTables,
            missingColumns: schema.missingColumns,
            missingIndexes: schema.missingIndexes,
          },
        },
      },
      { status: 503 },
    );
  }

  try {
    ensureWorkerStarted();
    return NextResponse.json({
      status: 'ok',
      enabledProviders: listEnabled().map((p) => p.id),
      db: 'ok',
      schema: {
        currentVersion: schema.currentVersion,
        requiredVersion: schema.requiredVersion,
      },
    });
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        enabledProviders: [],
        db: 'ok',
        schema: {
          currentVersion: schema.currentVersion,
          requiredVersion: schema.requiredVersion,
        },
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Service initialization failed',
          retryable: true,
        },
      },
      { status: 503 },
    );
  }
}
