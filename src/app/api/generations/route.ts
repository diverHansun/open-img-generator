import { NextResponse } from 'next/server';
import { ensureWorkerStarted, submitGeneration } from '../../../lib/job-engine';
import { assertDatabaseReady, db } from '../../../lib/db';
import { handleApiError } from '../error-handler';
import { listGenerations } from '../../../lib/library';
import { readJsonObject } from '../request-body';
import { getRequestId, withRequestId } from '../../../lib/request-id';

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    return NextResponse.json(
      listGenerations(
        {
          limit: parseLimit(query.get('limit')),
          cursor: query.get('cursor') ?? undefined,
          sessionId: query.get('sessionId') ?? undefined,
          projectId: query.get('projectId') ?? undefined,
        },
        db,
      ),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertDatabaseReady(db);
    ensureWorkerStarted();
    const body = (await readJsonObject(request)) as Parameters<typeof submitGeneration>[0];
    const result = await submitGeneration(body, { db });
    return withRequestId(
      NextResponse.json(
        {
          id: result.generationId,
          status: result.status,
          links: { self: `/api/generations/${result.generationId}` },
        },
        { status: 201 },
      ),
      requestId,
    );
  } catch (err) {
    return handleApiError(err, {
      structured: true,
      requestId,
      unexpectedRetryable: false,
    });
  }
}
