import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSession } from '../../../lib/db';
import { db } from '../../../lib/db';
import { handleApiError } from '../error-handler';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { title?: string };
    const now = new Date().toISOString();
    const session = createSession(
      {
        id: randomUUID(),
        title: body.title ?? null,
        createdAt: now,
        updatedAt: now,
      },
      db,
    );
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
