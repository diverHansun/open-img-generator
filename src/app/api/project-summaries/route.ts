import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { listProjectSummaries } from '../../../lib/library';
import { handleApiError } from '../error-handler';

export function GET() {
  try {
    return NextResponse.json(listProjectSummaries(db), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
