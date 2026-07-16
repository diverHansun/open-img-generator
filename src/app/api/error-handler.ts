import { NextResponse } from 'next/server';
import {
  ConflictError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  AuthenticationError,
} from '../../lib/errors';

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json(
      { error: err.message },
      { status: 429, headers: { 'Retry-After': '5' } },
    );
  }
  if (err instanceof AuthenticationError) {
    return NextResponse.json(
      { error: err.message },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }
  console.error('API error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
