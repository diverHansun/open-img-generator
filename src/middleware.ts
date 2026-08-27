import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizedEdgeRequest } from './lib/auth-edge';
import { getRequestId, withRequestId } from './lib/request-id';

export function middleware(request: NextRequest): NextResponse {
  if (
    request.nextUrl.pathname === '/api/health' ||
    request.nextUrl.pathname === '/api/health/live' ||
    request.nextUrl.pathname === '/api/auth/session'
  ) {
    return NextResponse.next();
  }
  if (isAuthorizedEdgeRequest(request)) return NextResponse.next();
  const requestId = getRequestId(request);
  return withRequestId(
    NextResponse.json(
      {
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          retryable: false,
          requestId,
        },
      },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    ),
    requestId,
  );
}

export const config = { matcher: ['/api/:path*'] };
