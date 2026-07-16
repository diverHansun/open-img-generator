import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { createSession, listSessions } from '../../../../../lib/library';
import { handleApiError } from '../../../error-handler';
import { readJsonObject } from '../../../request-body';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(listSessions((await params).id, db));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await readJsonObject(request);
    return NextResponse.json(
      createSession({ projectId: (await params).id, title: body.title }, db),
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
