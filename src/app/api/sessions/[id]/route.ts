import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/db';
import { getGeneration } from '../../../../lib/job-engine';
import { db } from '../../../../lib/db';
import { handleApiError } from '../../error-handler';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getSession(id, db);

    for (const generation of session.generations) {
      if (generation.status === 'pending' || generation.status === 'running') {
        await getGeneration(generation.id, { db });
      }
    }

    const refreshed = getSession(id, db);
    return NextResponse.json(refreshed);
  } catch (err) {
    return handleApiError(err);
  }
}
