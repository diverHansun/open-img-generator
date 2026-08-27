import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { addFavorite, listFavorites } from '../../../lib/library';
import { ValidationError } from '../../../lib/errors';
import { handleApiError } from '../error-handler';
import { readJsonObject } from '../request-body';

export function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const rawLimit = query.get('limit');
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    return NextResponse.json(
      listFavorites(
        {
          limit,
          cursor: query.get('cursor') ?? undefined,
          projectId: query.get('projectId') ?? undefined,
          provider: query.get('provider') ?? undefined,
          sort: query.get('sort') ?? undefined,
        },
        db,
      ),
    );
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (typeof body.imageId !== 'string') {
      throw new ValidationError('imageId is required');
    }
    // A repeated favorite is idempotent, so the stable response is 200.
    return NextResponse.json(addFavorite(body.imageId, db));
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
