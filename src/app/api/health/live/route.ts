import { NextResponse } from 'next/server';
import { getRequestId, withRequestId } from '../../../../lib/request-id';

export function GET(request: Request) {
  const requestId = getRequestId(request);
  return withRequestId(NextResponse.json({ status: 'ok' }), requestId);
}
