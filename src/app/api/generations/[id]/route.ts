import { NextResponse } from 'next/server';
import { deleteGeneration, getGeneration } from '../../../../lib/job-engine';
import { db } from '../../../../lib/db';
import { handleApiError } from '../../error-handler';
import { getRequestId, withRequestId } from '../../../../lib/request-id';
import { readJsonObject } from '../../request-body';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const { id } = await params;
    const view = await getGeneration(id, { db });
    return withRequestId(NextResponse.json(view), requestId);
  } catch (err) {
    return handleApiError(err, { structured: true, requestId });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    let confirmUnknownOutcome = false;
    if (request.body !== null) {
      const body = await readJsonObject(request, { maxBytes: 1_024 });
      confirmUnknownOutcome = body.confirmUnknownOutcome === true;
    }
    deleteGeneration(
      (await params).id,
      { confirmUnknownOutcome },
      { db },
    );
    return withRequestId(new Response(null, { status: 204 }), requestId);
  } catch (err) {
    return handleApiError(err, { structured: true, requestId });
  }
}
