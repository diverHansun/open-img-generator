import { providerMetadata } from '../../src/lib/provider-config/provider-metadata';

const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

const allowedExternalUrls = new Set([
  LICENSE_URL,
  ...providerMetadata.map((provider) => provider.keyApplyUrl),
]);

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return allowedExternalUrls.has(url.href);
  } catch {
    return false;
  }
}
