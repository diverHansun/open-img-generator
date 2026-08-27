import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { DesktopCredentialStorageMode } from '../../src/lib/desktop-bridge';

export type SafeStoragePort = {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(
    value: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
};

export type CredentialProtection = {
  mode: DesktopCredentialStorageMode;
  masterSecret?: string;
  warning?: 'safe-storage-unavailable' | 'safe-storage-failed';
};

export const CREDENTIAL_MASTER_FILE = 'credential-master-key.bin';

function isValidMasterSecret(value: string): boolean {
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function writeOwnerOnlyFile(filePath: string, data: Buffer): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temporaryPath = path.join(
    directory,
    `.credential-master.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, data, { mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the primary write/decrypt error.
    }
  }
}

export async function resolveCredentialProtection(
  configDirectory: string,
  safeStorage: SafeStoragePort,
): Promise<CredentialProtection> {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      return {
        mode: 'session-memory',
        warning: 'safe-storage-unavailable',
      };
    }

    const filePath = path.join(configDirectory, CREDENTIAL_MASTER_FILE);
    if (fs.existsSync(filePath)) {
      const encrypted = fs.readFileSync(filePath);
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (!isValidMasterSecret(decrypted.result)) {
        throw new Error('Credential master secret is invalid');
      }
      if (decrypted.shouldReEncrypt) {
        writeOwnerOnlyFile(
          filePath,
          await safeStorage.encryptStringAsync(decrypted.result),
        );
      }
      return { mode: 'encrypted-file', masterSecret: decrypted.result };
    }

    const masterSecret = crypto.randomBytes(32).toString('base64');
    writeOwnerOnlyFile(
      filePath,
      await safeStorage.encryptStringAsync(masterSecret),
    );
    return { mode: 'encrypted-file', masterSecret };
  } catch {
    return { mode: 'session-memory', warning: 'safe-storage-failed' };
  }
}
