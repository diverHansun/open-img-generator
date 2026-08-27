import {
  normalizeCredentials,
  readEncryptedCredentials,
  writeEncryptedCredentials,
} from './store';
import type { CredentialStorageMode, StoredCredentials } from './types';

let sessionCredentials: StoredCredentials = {};

export function getCredentialStorageMode(): CredentialStorageMode {
  return process.env.USER_CONFIG_STORAGE_MODE === 'session-memory'
    ? 'session-memory'
    : 'encrypted-file';
}

export function readCredentials(): StoredCredentials {
  return getCredentialStorageMode() === 'session-memory'
    ? { ...sessionCredentials }
    : readEncryptedCredentials();
}

export function writeCredentials(credentials: StoredCredentials): void {
  const normalized = normalizeCredentials(credentials);
  if (getCredentialStorageMode() === 'session-memory') {
    sessionCredentials = { ...normalized };
    return;
  }
  writeEncryptedCredentials(normalized);
}

export function resetSessionCredentials(): void {
  sessionCredentials = {};
}
