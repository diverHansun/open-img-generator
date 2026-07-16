import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getConfiguredAuthToken, isAuthorizedRequest } from '../../../../lib/auth';
import { AuthenticationError, ValidationError } from '../../../../lib/errors';
import { handleApiError } from '../../error-handler';
import { readJsonObject } from '../../request-body';
import crypto from 'node:crypto';

export async function POST(request: Request) {
  try {
    const expected = getConfiguredAuthToken();
    if (!expected) return NextResponse.json({ authenticated: true });
    const body = await readJsonObject(request);
    if (typeof body.token !== 'string' || body.token.length === 0) {
      throw new ValidationError('Token is required');
    }
    const provided = Buffer.from(body.token);
    const expectedBuffer = Buffer.from(expected);
    if (provided.length !== expectedBuffer.length || !crypto.timingSafeEqual(provided, expectedBuffer)) {
      throw new AuthenticationError('Invalid authentication token');
    }
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(AUTH_COOKIE_NAME, expected, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}

export function GET(request: Request) {
  return NextResponse.json({ authenticated: isAuthorizedRequest(request) });
}

export function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(AUTH_COOKIE_NAME, '', { maxAge: 0, path: '/' });
  return response;
}
