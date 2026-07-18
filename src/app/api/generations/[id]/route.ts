import { NextResponse } from 'next/server';
import { getGeneration } from '../../../../lib/job-engine';
import { db } from '../../../../lib/db';
import { handleApiError } from '../../error-handler';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const view = await getGeneration(id, { db });
    return NextResponse.json(view);
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
