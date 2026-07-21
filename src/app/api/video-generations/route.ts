import { NextResponse } from 'next/server';
import { ensureWorkerStarted, submitGeneration } from '../../../lib/job-engine';
import { assertDatabaseReady, db } from '../../../lib/db';
import { handleApiError } from '../error-handler';
import { readJsonObject } from '../request-body';
import { normalizeClientRequestId } from '../../../lib/job-engine/idempotency';

export async function POST(request: Request) {
  try {
    assertDatabaseReady(db);
    const payload = await readJsonObject(request);
    const result = await submitGeneration({
      ...payload,
      clientRequestId: normalizeClientRequestId(payload.clientRequestId),
      mode: 'text-to-video',
      count: 1,
    } as Parameters<typeof submitGeneration>[0], { db });
    ensureWorkerStarted();
    const self = `/api/generations/${result.generationId}`;
    return NextResponse.json({
      id: result.generationId,
      status: result.status,
      replayed: result.replayed,
      links: { self },
    }, { status: 202, headers: { Location: self } });
  } catch (err) {
    return handleApiError(err, { structured: true, unexpectedRetryable: false });
  }
}
