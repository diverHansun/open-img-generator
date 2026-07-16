import type { ProviderCredentialName, StoredCredentials } from './types';
import { readEncryptedCredentials } from './store';

let cachedUserCredentials: StoredCredentials | undefined;

function loadUserCredentials(): StoredCredentials {
  if (cachedUserCredentials) return cachedUserCredentials;
  try {
    cachedUserCredentials = readEncryptedCredentials();
  } catch {
    // A corrupt/missing-key user store must not prevent env-backed providers
    // from starting. The caller will still get env precedence below.
    console.warn('[user-config] encrypted credentials unavailable; falling back to environment');
    cachedUserCredentials = {};
  }
  return cachedUserCredentials;
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
  cachedUserCredentials = undefined;
}
