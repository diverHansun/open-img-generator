import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import {
  deleteProject,
  getProject,
  updateProject,
} from '../../../../lib/library';
import { handleApiError } from '../../error-handler';
import { readJsonObject } from '../../request-body';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(getProject((await params).id, db));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await readJsonObject(request);
    return NextResponse.json(
      updateProject((await params).id, { title: body.title }, db),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    deleteProject((await params).id, db);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
