import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as nextEnv from '@next/env';
import { defineConfig } from 'drizzle-kit';

import { resolveRuntimePaths } from './src/lib/runtime-paths/core.js';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const nextEnvWithDefault = nextEnv as typeof nextEnv & {
  default?: Pick<typeof nextEnv, 'loadEnvConfig'>;
};
const loadEnvConfig = nextEnv.loadEnvConfig ?? nextEnvWithDefault.default?.loadEnvConfig;
Object.assign(process.env, { NODE_ENV: 'development' });
loadEnvConfig(projectRoot, true);
const runtimePaths = resolveRuntimePaths({
  projectRoot,
  mode: 'development',
  env: process.env,
  platform: process.platform,
});

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: runtimePaths.databasePath,
  },
});
