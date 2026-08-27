export type RuntimeMode = 'development' | 'production' | 'test';

export type RuntimePaths = {
  databasePath: string;
  storageRoot: string;
  userConfigDirectory: string;
  logDirectory: string;
};

export class RuntimePathError extends Error {
  code: string;
  resource?: string;
  path?: string;
}

export function resolveRuntimeMode(input?: {
  cliMode?: string;
  nodeEnv?: string;
}): RuntimeMode;

export function parseSqliteDatabasePath(
  value: string,
  options: { projectRoot: string; platform?: NodeJS.Platform },
): string;

export function resolveRuntimePaths(input: {
  projectRoot: string;
  mode?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  homeDirectory?: string;
  localAppData?: string;
}): RuntimePaths;
