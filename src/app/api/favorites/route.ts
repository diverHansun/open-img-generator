import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { addFavorite, listFavorites } from '../../../lib/library';
import { handleApiError } from '../error-handler';

export function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const rawLimit = query.get('limit');
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    return NextResponse.json(
      listFavorites(
        { limit, cursor: query.get('cursor') ?? undefined },
        db,
      ),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { imageId?: unknown };
    if (typeof body.imageId !== 'string') {
      return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
    }
    // A repeated favorite is idempotent, so the stable response is 200.
    return NextResponse.json(addFavorite(body.imageId, db));
  } catch (err) {
    return handleApiError(err);
  }
}
