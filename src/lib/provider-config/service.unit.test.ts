import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb, type TestDb } from '../../../tests/helpers/db';
import {
  CredentialManagedByEnvironmentError,
  ConfigurationUnavailableError,
} from '../errors';
import { getCredentialsFilePath, readEncryptedCredentials } from '../user-config';
import {
  getProviderConfiguration,
  listProviderConfigurations,
  providerCatalog,
  removeProviderCredential,
  resetProviderConfigurationState,
  setProviderCredential,
} from './index';

describe('provider configuration service', () => {
  const originalEnv = { ...process.env };
  let testDb: TestDb;
  let tempDir: string;

  beforeEach(() => {
    testDb = createTestDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-config-test-'));
    process.env.USER_CONFIG_DIR = tempDir;
    process.env.USER_CONFIG_ENCRYPTION_KEY = 'provider-config-test-master-key';
    for (const key of providerCatalog.map((entry) => entry.credentialName)) {
      delete process.env[key];
    }
    resetProviderConfigurationState();
  });

  afterEach(() => {
    testDb.sqlite.close();
    process.env = { ...originalEnv };
    resetProviderConfigurationState();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a fixed, safe catalog even before any provider is configured', () => {
    const configurations = listProviderConfigurations(testDb.db);

    expect(configurations).toHaveLength(7);
    expect(configurations.map((configuration) => configuration.providerId)).toEqual(
      providerCatalog.map((entry) => entry.providerId),
    );
    expect(configurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'kling',
          credentialName: 'KLING_API_KEY',
          source: 'none',
          configured: false,
          editable: true,
        }),
      ]),
    );
    for (const configuration of configurations) {
      expect(configuration.keyApplyUrl).toMatch(/^https:\/\//);
      expect(Object.keys(configuration).sort()).toEqual([
        'availableModelCount',
        'configured',
        'credentialName',
        'displayName',
        'editable',
        'enabledModelCount',
        'keyApplyUrl',
        'models',
        'providerId',
        'source',
      ]);
    }
  });

  it('writes and removes only the target encrypted key without exposing a canary', async () => {
    const canary = 'secret-e2e-canary-provider-config';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const saved = await setProviderCredential('fal', canary, testDb.db);
    const serialized = JSON.stringify(saved);

    expect(saved).toMatchObject({ source: 'user-config', configured: true, editable: true });
    expect(serialized).not.toContain(canary);
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining(canary));
    expect(fs.readFileSync(getCredentialsFilePath(), 'utf8')).not.toContain(canary);
    expect(readEncryptedCredentials()).toMatchObject({ FAL_KEY: canary });

    const removed = await removeProviderCredential('fal', testDb.db);
    expect(removed).toMatchObject({ source: 'none', configured: false });
    expect(readEncryptedCredentials()).not.toHaveProperty('FAL_KEY');
    consoleError.mockRestore();
  });

  it('serializes simultaneous provider saves so neither key is lost', async () => {
    await Promise.all([
      setProviderCredential('fal', 'fal-user-key', testDb.db),
      setProviderCredential('kling', 'kling-user-key', testDb.db),
    ]);

    expect(readEncryptedCredentials()).toMatchObject({
      FAL_KEY: 'fal-user-key',
      KLING_API_KEY: 'kling-user-key',
    });
  });

  it('keeps environment credentials read-only', async () => {
    process.env.FAL_KEY = 'env-owned-key';

    expect(getProviderConfiguration('fal', testDb.db)).toMatchObject({
      source: 'env',
      editable: false,
    });
    await expect(setProviderCredential('fal', 'attempted-replacement', testDb.db)).rejects.toBeInstanceOf(
      CredentialManagedByEnvironmentError,
    );
    await expect(removeProviderCredential('fal', testDb.db)).rejects.toBeInstanceOf(
      CredentialManagedByEnvironmentError,
    );
  });

  it('reports a configuration error when a write has no encryption master key', async () => {
    delete process.env.USER_CONFIG_ENCRYPTION_KEY;

    await expect(setProviderCredential('fal', 'value', testDb.db)).rejects.toBeInstanceOf(
      ConfigurationUnavailableError,
    );
  });
});
