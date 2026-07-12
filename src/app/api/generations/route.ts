import { NextResponse } from 'next/server';
import { submitGeneration } from '../../../lib/job-engine';
import { db } from '../../../lib/db';
import { handleApiError } from '../error-handler';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Parameters<typeof submitGeneration>[0];
    const result = await submitGeneration(body, { db });
    return NextResponse.json(
      {
        id: result.generationId,
        status: result.status,
        links: { self: `/api/generations/${result.generationId}` },
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
