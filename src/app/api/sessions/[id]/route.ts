import { NextResponse } from 'next/server';
import { getSession, db } from '../../../../lib/db';
import { getGeneration } from '../../../../lib/job-engine';
import { handleApiError } from '../../error-handler';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getSession(id, db);

    const generations = await Promise.all(
      session.generations.map((generation) =>
        getGeneration(generation.id, { db }),
      ),
    );

    return NextResponse.json({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      generations,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
