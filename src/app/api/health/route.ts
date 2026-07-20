import { NextResponse } from 'next/server';
import { listEnabled } from '../../../lib/providers';
import { db, inspectDatabaseCompatibility } from '../../../lib/db';
import { ensureWorkerStarted } from '../../../lib/job-engine';
import { logApiFailure } from '../../../lib/observability/safe-logger';
import { getRequestId, withRequestId } from '../../../lib/request-id';

export function GET(request: Request) {
  const requestId = getRequestId(request);
  let schema: ReturnType<typeof inspectDatabaseCompatibility>;
  try {
    schema = inspectDatabaseCompatibility(db);
  } catch (error) {
    logApiFailure({
      requestId,
      code: 'DATABASE_UNAVAILABLE',
      status: 503,
      error,
    });
    return withRequestId(
      NextResponse.json(
        {
          status: 'error',
          enabledProviders: [],
          db: 'error',
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database is unavailable',
            retryable: true,
            requestId,
          },
        },
        { status: 503 },
      ),
      requestId,
    );
  }

  if (!schema.ready) {
    const schemaErrorView = {
      currentVersion: schema.currentVersion,
      requiredVersion: schema.requiredVersion,
      foreignKeysEnabled: schema.foreignKeysEnabled,
      missingTables: schema.missingTables,
      missingColumns: schema.missingColumns,
      missingIndexes: schema.missingIndexes,
    };
    return withRequestId(
      NextResponse.json(
        {
          status: 'error',
          enabledProviders: [],
          db: 'error',
          schema: schemaErrorView,
          error: {
            code: 'SCHEMA_NOT_READY',
            message: 'Database schema is not ready',
            retryable: false,
            requestId,
            details: schemaErrorView,
          },
        },
        { status: 503 },
      ),
      requestId,
    );
  }

  try {
    ensureWorkerStarted();
    return withRequestId(
      NextResponse.json({
        status: 'ok',
        enabledProviders: listEnabled().map((p) => p.id),
        db: 'ok',
        schema: {
          currentVersion: schema.currentVersion,
          requiredVersion: schema.requiredVersion,
        },
      }),
      requestId,
    );
  } catch (error) {
    logApiFailure({
      requestId,
      code: 'INTERNAL_ERROR',
      status: 503,
      error,
    });
    return withRequestId(
      NextResponse.json(
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
            requestId,
          },
        },
        { status: 503 },
      ),
      requestId,
    );
  }
}
