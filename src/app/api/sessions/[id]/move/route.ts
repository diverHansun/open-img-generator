import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { moveSession } from '../../../../../lib/library';
import { handleApiError } from '../../../error-handler';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = (await request.json()) as { toProjectId?: unknown };
    return NextResponse.json(
      moveSession((await params).id, { toProjectId: body.toProjectId }, db),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
