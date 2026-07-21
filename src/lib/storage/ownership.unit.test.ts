import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageError } from '../errors';
import { createTestDb } from '../../../tests/helpers/db';
import {
  acquireCleanupLock,
  verifyStorageOwnership,
} from './ownership';

describe('storage ownership', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-owner-test-'));
    process.env.DATABASE_URL = `file:${path.join(root, 'db-a.sqlite')}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('claims an empty root atomically and accepts the same database again', () => {
    expect(verifyStorageOwnership(root).claimed).toBe(true);
    expect(verifyStorageOwnership(root).claimed).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, '.open-image-storage.json'), 'utf8')),
    ).toMatchObject({ version: 1 });
  });

  it('refuses a second database without exposing either path', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    verifyStorageOwnership(root);
    process.env.DATABASE_URL = `file:${path.join(root, 'db-b.sqlite')}`;

    expect(() => verifyStorageOwnership(root)).toThrow(StorageError);
    const output = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(output).toContain('storage.ownership_refused');
    expect(output).not.toContain('db-a.sqlite');
    expect(output).not.toContain('db-b.sqlite');
  });

  it('refuses malformed markers and unknown pre-existing media', () => {
    fs.writeFileSync(path.join(root, '.open-image-storage.json'), '{}');
    expect(() => verifyStorageOwnership(root)).toThrow(StorageError);
    fs.rmSync(path.join(root, '.open-image-storage.json'));
    fs.writeFileSync(path.join(root, 'unknown.png'), 'data');
    const testDb = createTestDb();
    expect(() => verifyStorageOwnership(root, testDb.db)).toThrow(StorageError);
    testDb.sqlite.close();
  });

  it('serializes cleanup with an owned lock', () => {
    verifyStorageOwnership(root);
    const first = acquireCleanupLock(root);
    expect(first).not.toBeNull();
    expect(acquireCleanupLock(root)).toBeNull();
    first!.release();
    const next = acquireCleanupLock(root);
    expect(next).not.toBeNull();
    next!.release();
  });
});
