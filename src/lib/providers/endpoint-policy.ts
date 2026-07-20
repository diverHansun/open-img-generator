export const MAX_PROVIDER_EXTERNAL_ID_LENGTH = 512;
export const MAX_PROVIDER_ENDPOINT_URL_LENGTH = 8 * 1_024;

export class ProviderEndpointError extends Error {
  constructor() {
    super('Provider endpoint configuration is invalid');
    this.name = 'ProviderEndpointError';
  }
}

function trustedProviderPathSegment(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_EXTERNAL_ID_LENGTH ||
    value === '.' ||
    value === '..'
  ) {
    throw new ProviderEndpointError();
  }
  return value;
}

function parseHttpUrl(value: string): URL {
  if (value.length === 0 || value.length > MAX_PROVIDER_ENDPOINT_URL_LENGTH) {
    throw new ProviderEndpointError();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProviderEndpointError();
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new ProviderEndpointError();
  }
  return parsed;
}

/** Validates a configured Provider base before it can be combined with IDs. */
export function trustedProviderBaseUrl(value: string): URL {
  const parsed = parseHttpUrl(value);
  if (parsed.search || parsed.hash) throw new ProviderEndpointError();
  return parsed;
}

/** Rejects attacker-controlled DB/provider task identifiers before URL construction. */
export function trustedProviderExternalId(value: unknown): string {
  return trustedProviderPathSegment(value);
}

/** Appends path segments without allowing a segment to become a URL authority/path escape. */
export function providerEndpointUrl(base: URL, segments: readonly string[]): string {
  // encodeURIComponent leaves `.` and `..` untouched; fetch/WHATWG URL
  // normalization would then remove path components. Validate each segment
  // before encoding, including provider model parts split by '/'.
  const path = segments
    .map((segment) => encodeURIComponent(trustedProviderPathSegment(segment)))
    .join('/');
  const basePath = base.pathname.replace(/\/+$/, '');
  return `${base.origin}${basePath}/${path}`;
}

/**
 * Fal returns status/response/cancel URLs dynamically. They can carry signed
 * query params, but must remain an absolute same-origin HTTP(S) endpoint.
 */
export function trustedSameOriginProviderUrl(
  value: unknown,
  expectedOrigin: string,
): string {
  if (typeof value !== 'string') throw new ProviderEndpointError();
  const parsed = parseHttpUrl(value);
  if (parsed.origin !== expectedOrigin) throw new ProviderEndpointError();
  return parsed.toString();
}
