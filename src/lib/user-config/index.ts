export * from './types';
export * from './paths';
export * from './store';
export * from './resolve-credentials';

import { writeEncryptedCredentials } from './store';
import { clearCredentialCache } from './resolve-credentials';
import type { StoredCredentials } from './types';

/** Persist credentials and make the new values visible to registry/adapters. */
export function writeCredentials(credentials: StoredCredentials): void {
  writeEncryptedCredentials(credentials);
  clearCredentialCache();
}
