import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  db,
  getDatabasePathHash,
  listStoragePaths,
  listVideoStoragePaths,
  type DbClient,
} from '../db';
import { StorageError } from '../errors';
import { logSafeEvent } from '../observability/safe-logger';

const MARKER_NAME = '.open-image-storage.json';
const LOCK_NAME = '.cleanup.lock';
const MARKER_VERSION = 1;
const LOCK_STALE_MS = 15 * 60_000;

type Marker = { version: 1; databasePathHash: string };
type CleanupLock = { version: 1; token: string; pid: number; createdAt: string };

export type StorageOwnership = {
  ownerHash: string;
  ownerHashPrefix: string;
  claimed: boolean;
};

function markerPath(root: string): string {
  return path.join(root, MARKER_NAME);
}

function parseMarker(contents: string): Marker | null {
  try {
    const value = JSON.parse(contents) as Record<string, unknown>;
    if (
      value.version !== MARKER_VERSION ||
      typeof value.databasePathHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.databasePathHash) ||
      Object.keys(value).some((key) => key !== 'version' && key !== 'databasePathHash')
    ) return null;
    return value as Marker;
  } catch {
    return null;
  }
}

export function isStorageInternalPath(relativePath: string): boolean {
  return relativePath === MARKER_NAME || relativePath === LOCK_NAME;
}

function walkFormalMediaFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        if (relative === '.staging' || relative === '.tmp') continue;
        visit(absolute);
      } else if (entry.isFile() && !isStorageInternalPath(relative)) {
        files.push(relative);
      }
    }
  };
  visit(root);
  return files.sort();
}

function liveMediaPaths(client: DbClient): string[] {
  return [...listStoragePaths(client), ...listVideoStoragePaths(client)].sort();
}

function setsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function refuse(expected: string, actual: string, reason: 'mismatch' | 'invalid_marker' | 'unsafe_adoption'): never {
  logSafeEvent({
    event: 'storage.ownership_refused',
    expectedOwnerHashPrefix: expected.slice(0, 12),
    actualOwnerHashPrefix: actual.slice(0, 12) || 'unknown',
    reason,
  });
  throw new StorageError('Storage directory ownership could not be verified');
}

export function verifyStorageOwnership(
  root: string,
  client: DbClient = db,
): StorageOwnership {
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const expected = getDatabasePathHash();
  const file = markerPath(root);
  if (fs.existsSync(file)) {
    const marker = parseMarker(fs.readFileSync(file, 'utf8'));
    if (!marker) return refuse(expected, '', 'invalid_marker');
    if (marker.databasePathHash !== expected) {
      return refuse(expected, marker.databasePathHash, 'mismatch');
    }
    return { ownerHash: expected, ownerHashPrefix: expected.slice(0, 12), claimed: false };
  }

  const formalFiles = walkFormalMediaFiles(root);
  if (formalFiles.length > 0 && !setsEqual(formalFiles, liveMediaPaths(client))) {
    return refuse(expected, '', 'unsafe_adoption');
  }
  const marker: Marker = { version: MARKER_VERSION, databasePathHash: expected };
  try {
    fs.writeFileSync(file, JSON.stringify(marker) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const winner = parseMarker(fs.readFileSync(file, 'utf8'));
    if (!winner) return refuse(expected, '', 'invalid_marker');
    if (winner.databasePathHash !== expected) {
      return refuse(expected, winner.databasePathHash, 'mismatch');
    }
    return { ownerHash: expected, ownerHashPrefix: expected.slice(0, 12), claimed: false };
  }
  logSafeEvent({
    event: 'storage.ownership_claimed',
    ownerHashPrefix: expected.slice(0, 12),
    adoptedFiles: formalFiles.length,
  });
  return { ownerHash: expected, ownerHashPrefix: expected.slice(0, 12), claimed: true };
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function staleLock(file: string): boolean {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CleanupLock>;
    const createdAt = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : NaN;
    return Number.isFinite(createdAt) && Date.now() - createdAt > LOCK_STALE_MS &&
      typeof value.pid === 'number' && !processExists(value.pid);
  } catch {
    return false;
  }
}

export function acquireCleanupLock(root: string): { release: () => void } | null {
  const file = path.join(root, LOCK_NAME);
  const token = randomUUID();
  const lock: CleanupLock = {
    version: 1,
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  const create = () => fs.writeFileSync(file, JSON.stringify(lock) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!staleLock(file)) return null;
    fs.rmSync(file, { force: true });
    try {
      create();
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') return null;
      throw retryError;
    }
  }
  return {
    release: () => {
      try {
        const current = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CleanupLock>;
        if (current.token === token) fs.rmSync(file, { force: true });
      } catch {
        // A missing or externally replaced lock is not ours to remove.
      }
    },
  };
}

export function storagePathHash(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex').slice(0, 16);
}
