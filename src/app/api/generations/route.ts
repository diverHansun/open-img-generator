import { NextResponse } from 'next/server';
import { ensureWorkerStarted, submitGeneration } from '../../../lib/job-engine';
import { assertDatabaseReady, db } from '../../../lib/db';
import { handleApiError } from '../error-handler';
import { listGenerations } from '../../../lib/library';
import { readJsonObject } from '../request-body';
import { getRequestId, withRequestId } from '../../../lib/request-id';
import { normalizeClientRequestId } from '../../../lib/job-engine/idempotency';
import { ValidationError } from '../../../lib/errors';

function normalizeSubmissionIntent(
  payload: Record<string, unknown>,
  idempotencyHeader: string | null,
): Parameters<typeof submitGeneration>[0] {
  if (
    idempotencyHeader !== null &&
    idempotencyHeader !== payload.clientRequestId
  ) {
    throw new ValidationError('Idempotency-Key must match clientRequestId');
  }
  const clientRequestId = normalizeClientRequestId(payload.clientRequestId);
  return { ...payload, clientRequestId } as Parameters<typeof submitGeneration>[0];
}

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
    const body = normalizeSubmissionIntent(
      await readJsonObject(request),
      request.headers.get('Idempotency-Key'),
    );
    const result = await submitGeneration(body, { db });
    // Bootstrap only after durable admission. The worker is intentionally not
    // awaited: a successful POST means the intent is recoverable, not that a
    // Provider has already finished or even accepted it.
    ensureWorkerStarted();
    const self = `/api/generations/${result.generationId}`;
    return withRequestId(
      NextResponse.json(
        {
          id: result.generationId,
          status: result.status,
          replayed: result.replayed,
          links: { self },
        },
        { status: 202, headers: { Location: self } },
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
