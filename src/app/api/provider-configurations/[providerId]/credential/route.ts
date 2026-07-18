import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import {
  removeProviderCredential,
  setProviderCredential,
} from '../../../../../lib/provider-config';
import { handleApiError } from '../../../error-handler';
import { readJsonObject } from '../../../request-body';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  try {
    const body = await readJsonObject(request);
    const configuration = await setProviderCredential(
      (await params).providerId,
      body.value,
      db,
    );
    return NextResponse.json(configuration, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  try {
    const configuration = await removeProviderCredential(
      (await params).providerId,
      db,
    );
    return NextResponse.json(configuration, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
