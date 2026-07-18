import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { listProviderConfigurations } from '../../../lib/provider-config';
import { handleApiError } from '../error-handler';

export function GET() {
  try {
    return NextResponse.json(listProviderConfigurations(db), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
