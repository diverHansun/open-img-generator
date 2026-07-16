import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { moveSession } from '../../../../../lib/library';
import { handleApiError } from '../../../error-handler';
import { readJsonObject } from '../../../request-body';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await readJsonObject(request);
    return NextResponse.json(
      moveSession((await params).id, { toProjectId: body.toProjectId }, db),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
