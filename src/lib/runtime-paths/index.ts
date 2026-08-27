import 'server-only';

import os from 'node:os';
import path from 'node:path';

import {
  parseSqliteDatabasePath,
  resolveRuntimeMode,
  resolveRuntimePaths,
  RuntimePathError,
  type RuntimeMode,
  type RuntimePaths,
} from './core.js';

export {
  parseSqliteDatabasePath,
  resolveRuntimeMode,
  resolveRuntimePaths,
  RuntimePathError,
};
export type { RuntimeMode, RuntimePaths };

export function getRuntimePaths(input: {
  projectRoot?: string;
  mode?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  localAppData?: string;
} = {}): RuntimePaths {
  const env = input.env ?? process.env;
  return resolveRuntimePaths({
    projectRoot: path.resolve(input.projectRoot ?? process.cwd()),
    mode: input.mode,
    platform: input.platform ?? process.platform,
    env,
    homeDirectory: input.homeDirectory ?? os.homedir(),
    localAppData: input.localAppData,
  });
}
