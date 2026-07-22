import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CREDENTIAL_MASTER_FILE,
  resolveCredentialProtection,
  type SafeStoragePort,
} from './credential-secret';

function createSafeStorage(options?: {
  available?: boolean;
  shouldReEncrypt?: boolean;
}): SafeStoragePort {
  return {
    isAsyncEncryptionAvailable: async () => options?.available ?? true,
    encryptStringAsync: async (value) => Buffer.from(value, 'utf8').reverse(),
    decryptStringAsync: async (value) => {
      return {
        result: Buffer.from(value).reverse().toString('utf8'),
        shouldReEncrypt: options?.shouldReEncrypt ?? false,
      };
    },
  };
}

describe('desktop credential master secret', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-credential-secret-test-'),
    );
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('creates an owner-only protected secret and restores it across launches', async () => {
    const first = await resolveCredentialProtection(
      directory,
      createSafeStorage(),
    );
    const second = await resolveCredentialProtection(
      directory,
      createSafeStorage(),
    );
    const filePath = path.join(directory, CREDENTIAL_MASTER_FILE);

    expect(first.mode).toBe('encrypted-file');
    expect(second).toEqual(first);
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain(
      first.masterSecret!,
    );
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('uses session-memory mode when OS encryption is unavailable', async () => {
    const result = await resolveCredentialProtection(
      directory,
      createSafeStorage({ available: false }),
    );

    expect(result).toEqual({
      mode: 'session-memory',
      warning: 'safe-storage-unavailable',
    });
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('does not overwrite a master file that cannot be decrypted', async () => {
    const filePath = path.join(directory, CREDENTIAL_MASTER_FILE);
    fs.writeFileSync(filePath, 'unreadable-keychain-payload');

    const result = await resolveCredentialProtection(
      directory,
      createSafeStorage(),
    );

    expect(result).toEqual({
      mode: 'session-memory',
      warning: 'safe-storage-failed',
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      'unreadable-keychain-payload',
    );
  });
});
