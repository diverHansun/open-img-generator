import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import {
  listModelPreferences,
  upsertModelPreference,
} from '../../../lib/library';
import { handleApiError } from '../error-handler';
import { readJsonObject } from '../request-body';

export function GET() {
  return NextResponse.json({ items: listModelPreferences(db) });
}

export async function PUT(request: Request) {
  try {
    const body = await readJsonObject(request);
    return NextResponse.json(
      upsertModelPreference(
        {
          provider: body.provider,
          model: body.model,
          enabled: body.enabled,
        },
        db,
      ),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
