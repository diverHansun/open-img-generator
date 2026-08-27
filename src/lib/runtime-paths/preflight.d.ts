import type { RuntimePathError, RuntimePaths } from './core.js';

type FileSystemPermissions = {
  chmodSync(path: string, mode: number): void;
};

export function applyPrivateDirectoryPermissions(
  directory: string,
  options?: { platform?: NodeJS.Platform; fileSystem?: FileSystemPermissions },
): void;

export function applyPrivateFilePermissions(
  filePath: string,
  options?: { platform?: NodeJS.Platform; fileSystem?: FileSystemPermissions },
): void;

export function preflightRuntimePaths(
  runtimePaths: RuntimePaths,
  options?: { platform?: NodeJS.Platform },
): { warnings: RuntimePathError[] };
