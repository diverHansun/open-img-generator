import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import {
  deleteSession,
  getSession,
  listGenerations,
  updateSession,
} from '../../../../lib/library';
import { handleApiError } from '../../error-handler';
import { readJsonObject } from '../../request-body';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getSession(id, db);
    const includeGenerations =
      new URL(request.url).searchParams.get('include') === 'generations';
    if (!includeGenerations) return NextResponse.json(session);

    // Deliberately read-only. Only GET /api/generations/:id advances jobs.
    const generations = listGenerations({ sessionId: id, limit: 50 }, db);
    return NextResponse.json({ ...session, generations: generations.items });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await readJsonObject(request);
    return NextResponse.json(updateSession(id, { title: body.title }, db));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(deleteSession(id, db));
  } catch (err) {
    return handleApiError(err);
  }
}
