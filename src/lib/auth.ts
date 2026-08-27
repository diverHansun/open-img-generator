import crypto from 'node:crypto';
import { AUTH_COOKIE_NAME } from './auth-cookie';
export { AUTH_COOKIE_NAME } from './auth-cookie';

function configuredToken(): string | undefined {
  const token = process.env.APP_AUTH_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function authEnabled(): boolean {
  return Boolean(configuredToken());
}

export function isAuthorizedRequest(request: Request): boolean {
  const expected = configuredToken();
  if (!expected) return true;
  const authorization = request.headers.get('authorization') ?? '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && safeEqual(bearer, expected)) return true;
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookie = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${AUTH_COOKIE_NAME}=`))
    ?.slice(AUTH_COOKIE_NAME.length + 1);
  if (!cookie) return false;
  try {
    return safeEqual(decodeURIComponent(cookie), expected);
  } catch {
    return false;
  }
}

export function getConfiguredAuthToken(): string | undefined {
  return configuredToken();
}
