import { AUTH_COOKIE_NAME } from './auth-cookie';

function configuredToken(): string | undefined {
  const token = process.env.APP_AUTH_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

// Middleware may execute in the Edge runtime, where node:crypto is unavailable.
// Keep the comparison length-independent without importing Node-only modules.
function safeEqual(left: string, right: string): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

export function isAuthorizedEdgeRequest(request: Request): boolean {
  const expected = configuredToken();
  if (!expected) return true;

  const authorization = request.headers.get('authorization') ?? '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && safeEqual(bearer, expected)) return true;

  const cookieHeader = request.headers.get('cookie') ?? '';
  const encoded = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${AUTH_COOKIE_NAME}=`))
    ?.slice(AUTH_COOKIE_NAME.length + 1);
  if (!encoded) return false;
  try {
    return safeEqual(decodeURIComponent(encoded), expected);
  } catch {
    return false;
  }
}
