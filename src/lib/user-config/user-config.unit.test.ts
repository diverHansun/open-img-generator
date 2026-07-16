import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearCredentialCache,
  getCredentialsFilePath,
  hasCredential,
  readEncryptedCredentials,
  resolveCredential,
  writeCredentials,
} from './index';

describe('encrypted user credentials', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-config-test-'));
    process.env.USER_CONFIG_DIR = tempDir;
    process.env.USER_CONFIG_ENCRYPTION_KEY = 'test-master-secret';
    delete process.env.KLING_API_KEY;
    delete process.env.FAL_KEY;
    clearCredentialCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearCredentialCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('round-trips credentials in an encrypted, owner-only file', () => {
    writeCredentials({ KLING_API_KEY: 'kling-secret', FAL_KEY: 'fal-secret' });

    const filePath = getCredentialsFilePath();
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('kling-secret');
    expect(raw).not.toContain('fal-secret');
    expect(readEncryptedCredentials()).toEqual({
      KLING_API_KEY: 'kling-secret',
      FAL_KEY: 'fal-secret',
    });
    expect(fs.statSync(tempDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('uses environment credentials first and falls back to the encrypted store', () => {
    writeCredentials({ KLING_API_KEY: 'stored-key' });
    process.env.KLING_API_KEY = 'env-key';
    expect(resolveCredential('KLING_API_KEY')).toBe('env-key');

    delete process.env.KLING_API_KEY;
    clearCredentialCache();
    expect(resolveCredential('KLING_API_KEY')).toBe('stored-key');
    expect(hasCredential('KLING_API_KEY')).toBe(true);
  });

  it('does not make a corrupt store prevent env-backed startup', () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(getCredentialsFilePath(), '{not-json');
    clearCredentialCache();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveCredential('FAL_KEY')).toBeUndefined();
    expect(warning).toHaveBeenCalledOnce();
    process.env.FAL_KEY = 'env-fallback';
    expect(resolveCredential('FAL_KEY')).toBe('env-fallback');
    warning.mockRestore();
  });

  it('requires the encryption key when a user store exists', () => {
    writeCredentials({ KLING_API_KEY: 'stored-key' });
    delete process.env.USER_CONFIG_ENCRYPTION_KEY;
    clearCredentialCache();
    expect(() => readEncryptedCredentials()).toThrow('USER_CONFIG_ENCRYPTION_KEY');
  });

  it('rejects unknown credential names', () => {
    expect(() => writeCredentials({ UNKNOWN_KEY: 'secret' } as never)).toThrow(
      'Unknown provider credential',
    );
  });
});
