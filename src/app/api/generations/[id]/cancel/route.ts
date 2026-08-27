import { NextResponse } from 'next/server';
import { cancelGeneration } from '../../../../../lib/job-engine';
import { db } from '../../../../../lib/db';
import { handleApiError } from '../../../error-handler';
import { getRequestId, withRequestId } from '../../../../../lib/request-id';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const { id } = await params;
    return withRequestId(
      NextResponse.json(await cancelGeneration(id, { db })),
      requestId,
    );
  } catch (err) {
    return handleApiError(err, { structured: true, requestId });
  }
}
