import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { providerMetadata } from '../../src/lib/provider-config/provider-metadata';

import {
  createDesktopDataPaths,
  createDesktopRuntimeEnvironment,
} from './environment';

describe('desktop runtime environment', () => {
  it('maps every mutable runtime path into the data folder below user data', () => {
    const paths = createDesktopDataPaths('/tmp/open-image-generator-user');

    expect(paths).toEqual({
      root: path.resolve('/tmp/open-image-generator-user/data'),
      database: path.resolve('/tmp/open-image-generator-user/data/app.db'),
      images: path.resolve('/tmp/open-image-generator-user/data/images'),
      config: path.resolve('/tmp/open-image-generator-user/data/config'),
      logs: path.resolve('/tmp/open-image-generator-user/data/logs'),
    });
  });

  it('protects the loopback server and removes provider environment keys', () => {
    const paths = createDesktopDataPaths('/tmp/open-image-generator-user');
    const environment = createDesktopRuntimeEnvironment({
      baseEnvironment: Object.fromEntries([
        ...providerMetadata.map((provider) => [provider.credentialName, 'must-not-leak']),
        ['PATH', '/usr/bin'],
        ['DESKTOP_DEV_RUNTIME', '1'],
      ]),
      paths,
      port: 43123,
      authToken: 'launch-token',
      credentialStorageMode: 'encrypted-file',
      credentialMasterSecret: 'master-secret',
      development: false,
    });

    expect(environment).toMatchObject({
      HOSTNAME: '127.0.0.1',
      PORT: '43123',
      APP_AUTH_TOKEN: 'launch-token',
      DATABASE_URL: `file:${paths.database}`,
      LOCAL_STORAGE_DIR: paths.images,
      USER_CONFIG_DIR: paths.config,
      APP_LOG_DIR: paths.logs,
      USER_CONFIG_ENCRYPTION_KEY: 'master-secret',
      USER_CONFIG_STORAGE_MODE: 'encrypted-file',
      FAL_KEY: '',
      PATH: '/usr/bin',
    });
    for (const provider of providerMetadata) {
      expect(environment[provider.credentialName]).toBe('');
    }
    expect(environment.DESKTOP_DEV_RUNTIME).toBeUndefined();
  });

  it('does not pass a master secret in session-memory mode', () => {
    const environment = createDesktopRuntimeEnvironment({
      baseEnvironment: { USER_CONFIG_ENCRYPTION_KEY: 'stale-secret' },
      paths: createDesktopDataPaths('/tmp/open-image-generator-user'),
      port: 43123,
      authToken: 'launch-token',
      credentialStorageMode: 'session-memory',
      development: true,
    });

    expect(environment.USER_CONFIG_ENCRYPTION_KEY).toBeUndefined();
    expect(environment.USER_CONFIG_STORAGE_MODE).toBe('session-memory');
    expect(environment.NODE_ENV).toBe('development');
    expect(environment.DESKTOP_DEV_RUNTIME).toBe('1');
  });
});
