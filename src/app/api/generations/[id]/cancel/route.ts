import { NextResponse } from 'next/server';
import { cancelGeneration } from '../../../../../lib/job-engine';
import { db } from '../../../../../lib/db';
import { handleApiError } from '../../../error-handler';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await cancelGeneration(id, { db }));
  } catch (err) {
    return handleApiError(err);
  }
}
