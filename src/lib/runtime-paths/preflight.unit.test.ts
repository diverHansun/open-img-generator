import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimePaths } from './core.js';
import {
  applyPrivateDirectoryPermissions,
  applyPrivateFilePermissions,
  preflightRuntimePaths,
} from './preflight.js';

describe('runtime path preflight', () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function paths(): RuntimePaths {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Open Image Generator 测试 '));
    temporaryRoots.push(root);
    return {
      databasePath: path.join(root, 'database', 'app.db'),
      storageRoot: path.join(root, 'images'),
      userConfigDirectory: path.join(root, 'config'),
      logDirectory: path.join(root, 'logs'),
    };
  }

  it('creates required directories and removes all write probes', () => {
    const runtimePaths = paths();
    expect(preflightRuntimePaths(runtimePaths)).toEqual({ warnings: [] });
    for (const directory of [
      path.dirname(runtimePaths.databasePath),
      runtimePaths.storageRoot,
      runtimePaths.userConfigDirectory,
      runtimePaths.logDirectory,
    ]) {
      expect(fs.statSync(directory).isDirectory()).toBe(true);
      expect(fs.readdirSync(directory).some((entry) => entry.includes('write-probe'))).toBe(false);
    }
  });

  it('fails a required resource with structured local diagnostics', () => {
    const runtimePaths = paths();
    fs.writeFileSync(runtimePaths.storageRoot, 'not a directory');
    expect(() => preflightRuntimePaths(runtimePaths)).toThrow(expect.objectContaining({
      name: 'RuntimePathError',
      code: expect.any(String),
      resource: 'storage',
      path: runtimePaths.storageRoot,
    }));
  });

  it('returns a warning when only the log directory is unavailable', () => {
    const runtimePaths = paths();
    fs.writeFileSync(runtimePaths.logDirectory, 'not a directory');
    const result = preflightRuntimePaths(runtimePaths);
    expect(result.warnings).toEqual([
      expect.objectContaining({ resource: 'logs', path: runtimePaths.logDirectory }),
    ]);
  });

  it('requests POSIX private modes but leaves Windows ACL inheritance intact', () => {
    const chmodSync = vi.fn();
    const fileSystem = { chmodSync };
    applyPrivateDirectoryPermissions('/config', { platform: 'linux', fileSystem });
    applyPrivateFilePermissions('/config/settings.json', { platform: 'linux', fileSystem });
    expect(chmodSync.mock.calls).toEqual([
      ['/config', 0o700],
      ['/config/settings.json', 0o600],
    ]);

    chmodSync.mockClear();
    applyPrivateDirectoryPermissions('C:\\config', { platform: 'win32', fileSystem });
    applyPrivateFilePermissions('C:\\config\\settings.json', { platform: 'win32', fileSystem });
    expect(chmodSync).not.toHaveBeenCalled();
  });
});
