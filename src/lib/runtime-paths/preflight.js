import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { RuntimePathError } from './core.js';

function platformFrom(options) {
  return options?.platform ?? process.platform;
}

function fileSystemFrom(options) {
  return options?.fileSystem ?? fs;
}

export function applyPrivateDirectoryPermissions(directory, options) {
  if (platformFrom(options) === 'win32') return;
  fileSystemFrom(options).chmodSync(directory, 0o700);
}

export function applyPrivateFilePermissions(filePath, options) {
  if (platformFrom(options) === 'win32') return;
  fileSystemFrom(options).chmodSync(filePath, 0o600);
}

function runtimePathFailure(resource, targetPath, cause) {
  const causeCode = typeof cause === 'object' && cause !== null && 'code' in cause
    ? String(cause.code)
    : 'UNKNOWN';
  return new RuntimePathError(
    `Runtime ${resource} path is unavailable: ${targetPath}. Check that the path exists locally and is writable.`,
    {
      code: `RUNTIME_PATH_${causeCode}`,
      resource,
      path: targetPath,
      cause,
    },
  );
}

function ensureWritableDirectory(directory, resource, options) {
  const fileSystem = fileSystemFrom(options);
  let probePath;
  try {
    fileSystem.mkdirSync(directory, { recursive: true });
    if (!fileSystem.statSync(directory).isDirectory()) {
      throw Object.assign(new Error('Path is not a directory'), { code: 'ENOTDIR' });
    }
    applyPrivateDirectoryPermissions(directory, options);
    probePath = path.join(directory, `.write-probe-${process.pid}-${randomUUID()}`);
    fileSystem.writeFileSync(probePath, '', { flag: 'wx', mode: 0o600 });
    applyPrivateFilePermissions(probePath, options);
  } catch (cause) {
    throw runtimePathFailure(resource, directory, cause);
  } finally {
    if (probePath) {
      try {
        fileSystem.rmSync(probePath, { force: true });
      } catch {
        // The original availability result remains authoritative.
      }
    }
  }
}

export function preflightRuntimePaths(runtimePaths, options) {
  if (runtimePaths.databasePath !== ':memory:') {
    ensureWritableDirectory(
      path.dirname(runtimePaths.databasePath),
      'database',
      options,
    );
  }
  ensureWritableDirectory(runtimePaths.storageRoot, 'storage', options);
  ensureWritableDirectory(runtimePaths.userConfigDirectory, 'config', options);

  const warnings = [];
  try {
    ensureWritableDirectory(runtimePaths.logDirectory, 'logs', options);
  } catch (warning) {
    warnings.push(warning);
  }
  return { warnings };
}
