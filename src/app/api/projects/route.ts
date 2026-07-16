import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { createProject, listProjects } from '../../../lib/library';
import { handleApiError } from '../error-handler';

export function GET() {
  return NextResponse.json(listProjects(db));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { title?: unknown };
    return NextResponse.json(createProject({ title: body.title }, db), {
      status: 201,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
