import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { getProjectHistory } from '../../../../../lib/library';
import { handleApiError } from '../../../error-handler';

function parseInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  return Number(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const query = new URL(request.url).searchParams;
    return NextResponse.json(
      getProjectHistory(
        {
          projectId: (await params).id,
          page: parseInteger(query.get('page')),
          sessionLimit: parseInteger(query.get('sessionLimit')),
          generationLimit: parseInteger(query.get('generationLimit')),
        },
        db,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
