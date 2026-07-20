import { NextResponse } from 'next/server';
import { getGeneration } from '../../../../lib/job-engine';
import { db } from '../../../../lib/db';
import { handleApiError } from '../../error-handler';
import { getRequestId, withRequestId } from '../../../../lib/request-id';

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
