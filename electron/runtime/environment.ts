import path from 'node:path';

import { providerMetadata } from '../../src/lib/provider-config/provider-metadata';
import type { DesktopCredentialStorageMode } from '../../src/lib/desktop-bridge';

export type DesktopDataPaths = {
  root: string;
  database: string;
  images: string;
  config: string;
  logs: string;
};

export function createDesktopDataPaths(root: string): DesktopDataPaths {
  const resolvedRoot = path.resolve(root);
  return {
    root: resolvedRoot,
    database: path.join(resolvedRoot, 'app.db'),
    images: path.join(resolvedRoot, 'images'),
    config: path.join(resolvedRoot, 'config'),
    logs: path.join(resolvedRoot, 'logs'),
  };
}

export function createDesktopRuntimeEnvironment(input: {
  baseEnvironment?: Record<string, string | undefined>;
  paths: DesktopDataPaths;
  port: number;
  authToken: string;
  credentialStorageMode: DesktopCredentialStorageMode;
  credentialMasterSecret?: string;
  development: boolean;
}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...input.baseEnvironment,
    NODE_ENV: input.development ? 'development' : 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(input.port),
    DATABASE_URL: `file:${input.paths.database}`,
    LOCAL_STORAGE_DIR: input.paths.images,
    USER_CONFIG_DIR: input.paths.config,
    APP_LOG_DIR: input.paths.logs,
    APP_AUTH_TOKEN: input.authToken,
    USER_CONFIG_STORAGE_MODE: input.credentialStorageMode,
    NEXT_TELEMETRY_DISABLED: '1',
  };

  if (input.credentialStorageMode === 'encrypted-file') {
    environment.USER_CONFIG_ENCRYPTION_KEY = input.credentialMasterSecret;
  } else {
    delete environment.USER_CONFIG_ENCRYPTION_KEY;
  }

  // A desktop launch always resolves provider keys through the user config
  // domain. Empty values also prevent Next's development dotenv loader from
  // reintroducing a repository .env credential.
  for (const provider of providerMetadata) {
    environment[provider.credentialName] = '';
  }

  return environment;
}
