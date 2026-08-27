import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json(
    { error: 'Create sessions with POST /api/projects/:id/sessions' },
    { status: 400 },
  );
}
