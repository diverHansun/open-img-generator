import { NextResponse } from 'next/server';
import { db } from '../../../../../../lib/db';
import { ensureInitialSession } from '../../../../../../lib/library';
import { handleApiError } from '../../../../error-handler';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = ensureInitialSession(id, db);
    return NextResponse.json(result.session, {
      status: result.created ? 201 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
