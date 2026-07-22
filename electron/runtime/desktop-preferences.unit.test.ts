import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getDesktopPreferencesFilePath,
  readDownloadDirectory,
  resolveAvailableDownloadPath,
  writeDownloadDirectory,
} from './desktop-preferences';

describe('desktop preferences', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-preferences-test-'),
    );
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('round-trips an absolute download directory in an owner-only file', () => {
    const downloadDirectory = path.join(directory, 'exports');

    writeDownloadDirectory(directory, downloadDirectory);

    const filePath = getDesktopPreferencesFilePath(directory);
    expect(readDownloadDirectory(directory)).toBe(downloadDirectory);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('resets to the system default without preserving a custom path', () => {
    writeDownloadDirectory(directory, path.join(directory, 'exports'));
    writeDownloadDirectory(directory, undefined);

    expect(readDownloadDirectory(directory)).toBeUndefined();
  });

  it('rejects relative paths and ignores malformed preferences', () => {
    expect(() => writeDownloadDirectory(directory, 'relative/path')).toThrow(
      'absolute',
    );
    fs.writeFileSync(getDesktopPreferencesFilePath(directory), '{bad-json');
    expect(readDownloadDirectory(directory)).toBeUndefined();
  });

  it('keeps existing downloads and sanitizes empty traversal names', () => {
    fs.writeFileSync(path.join(directory, 'project.zip'), 'existing');

    expect(resolveAvailableDownloadPath(directory, 'project.zip')).toBe(
      path.join(directory, 'project (1).zip'),
    );
    expect(resolveAvailableDownloadPath(directory, '..')).toBe(
      path.join(directory, 'download'),
    );
  });
});
