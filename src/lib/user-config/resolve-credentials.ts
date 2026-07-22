import type { ProviderCredentialName, StoredCredentials } from './types';
import { readCredentials } from './credentials';

function loadUserCredentials(): StoredCredentials {
  try {
    return readCredentials();
  } catch {
    // A corrupt/missing-key user store must not prevent env-backed providers
    // from starting. The caller will still get env precedence below.
    console.warn('[user-config] encrypted credentials unavailable; falling back to environment');
    return {};
  }
}

export function resolveCredential(name: ProviderCredentialName): string | undefined {
  const envValue = process.env[name];
  if (envValue) return envValue;
  return loadUserCredentials()[name];
}

export function hasCredential(name: ProviderCredentialName): boolean {
  return Boolean(resolveCredential(name));
}

export function clearCredentialCache(): void {
  // Kept as a compatibility no-op. Credentials are small and are read at the
  // adapter boundary so session-memory updates are immediately visible.
}
