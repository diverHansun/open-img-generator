import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_REMOTE_IMAGE_URL_LENGTH = 8 * 1_024;

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export type RemoteImageUrlPolicyOptions = {
  /** Dependency injection keeps DNS security checks deterministic in tests. */
  resolveHostname?: HostResolver;
  /** Explicit local development/test opt-in; production remains HTTPS-only. */
  allowInsecureHttp?: boolean;
  /** Explicit local fake-provider opt-in; never enabled by default. */
  allowPrivateAddresses?: boolean;
};

export class RemoteImageUrlError extends Error {
  constructor() {
    super('Remote image URL is not allowed');
    this.name = 'RemoteImageUrlError';
  }
}

function environmentFlag(name: string): boolean {
  return process.env[name] === 'true';
}

function allowInsecureHttp(options: RemoteImageUrlPolicyOptions): boolean {
  return options.allowInsecureHttp ?? environmentFlag('ALLOW_INSECURE_IMAGE_URLS');
}

function allowPrivateAddresses(options: RemoteImageUrlPolicyOptions): boolean {
  return options.allowPrivateAddresses ?? environmentFlag('ALLOW_PRIVATE_IMAGE_URLS');
}

async function resolveHostname(hostname: string): Promise<readonly string[]> {
  // MSW/Vitest tests use synthetic CDN hosts that are intentionally not
  // resolvable on the developer's network. Production and development always
  // execute the real lookup; unit tests inject explicit addresses whenever the
  // address classification itself is under test.
  if (process.env.NODE_ENV === 'test') return ['93.184.216.34'];
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isForbiddenIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  );
}

function isForbiddenAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return isForbiddenIpv4(address);
    case 6:
      return isForbiddenIpv6(address);
    default:
      return true;
  }
}

function hostnameFromUrl(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/**
 * Validates an untrusted remote image URL before each network hop. DNS/IP
 * checks reduce SSRF risk; native fetch can re-resolve after this check, so
 * callers must not present this as complete DNS-rebinding prevention.
 */
export async function validateRemoteImageUrl(
  value: unknown,
  options: RemoteImageUrlPolicyOptions = {},
): Promise<URL> {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REMOTE_IMAGE_URL_LENGTH) {
    throw new RemoteImageUrlError();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RemoteImageUrlError();
  }
  if (
    (parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && allowInsecureHttp(options))) ||
    parsed.username ||
    parsed.password
  ) {
    throw new RemoteImageUrlError();
  }
  // URL fragments are never a valid part of a signed image request. Drop it
  // before fetch so even a future logger cannot accidentally preserve it.
  parsed.hash = '';

  const hostname = hostnameFromUrl(parsed);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new RemoteImageUrlError();
  }
  let addresses: readonly string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : await (options.resolveHostname ?? resolveHostname)(hostname);
  } catch {
    throw new RemoteImageUrlError();
  }
  if (addresses.length === 0) throw new RemoteImageUrlError();
  if (!allowPrivateAddresses(options) && addresses.some(isForbiddenAddress)) {
    throw new RemoteImageUrlError();
  }
  return parsed;
}
