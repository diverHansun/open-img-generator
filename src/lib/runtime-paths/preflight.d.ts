import type { RuntimePathError, RuntimePaths } from './core.js';

type FileSystemPermissions = {
  chmodSync(path: string, mode: number): void;
};

type RuntimeFileSystem = Pick<
  typeof import('node:fs'),
  'chmodSync' | 'mkdirSync' | 'statSync' | 'writeFileSync' | 'rmSync'
>;

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
  options?: { platform?: NodeJS.Platform; fileSystem?: RuntimeFileSystem },
): { warnings: RuntimePathError[] };
