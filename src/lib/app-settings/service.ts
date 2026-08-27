import fs from 'node:fs';
import path from 'node:path';

import { ValidationError } from '../errors';
import { getDatabasePath } from '../db';
import { getLocalLogDirectory } from '../observability/local-log-sink';
import { getStorageRoot } from '../storage';
import {
  parseImageRetentionDays,
  retentionPolicyFromDays,
  type RetentionPolicy,
} from '../storage/retention-policy';

import { readStoredAppSettings, writeAppSettings } from './store';
import {
  MAX_IMAGE_RETENTION_DAYS,
  type AppSettings,
  type LocalDataSummary,
} from './types';

function defaultImageRetentionDays(): number | null {
  const policy = parseImageRetentionDays();
  return policy.enabled ? policy.days : null;
}

function isRetentionDays(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 1 &&
      value <= MAX_IMAGE_RETENTION_DAYS)
  );
}

export function getAppSettings(): AppSettings {
  const stored = readStoredAppSettings();
  return {
    imageRetentionDays:
      stored?.imageRetentionDays === undefined
        ? defaultImageRetentionDays()
        : stored.imageRetentionDays,
  };
}

export function getImageRetentionPolicy(): RetentionPolicy {
  return retentionPolicyFromDays(getAppSettings().imageRetentionDays);
}

export function updateAppSettings(input: unknown): AppSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Settings must be an object');
  }
  const values = input as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(values, 'imageRetentionDays')) {
    throw new ValidationError('imageRetentionDays is required');
  }
  const value = values.imageRetentionDays;
  if (!isRetentionDays(value)) {
    throw new ValidationError(
      `imageRetentionDays must be null or an integer between 1 and ${MAX_IMAGE_RETENTION_DAYS}`,
    );
  }
  const settings: AppSettings = { imageRetentionDays: value };
  writeAppSettings(settings);
  return settings;
}

function bytesForFile(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function bytesForDirectory(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) total += bytesForFile(absolute);
      // Never follow symlinks while calculating application-owned storage.
    }
  };
  try {
    visit(root);
  } catch {
    // A concurrent cleanup or permission change may make one subtree unavailable.
  }
  return total;
}

function databaseBytes(): number {
  const databasePath = getDatabasePath();
  if (databasePath === ':memory:') return 0;
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].reduce(
    (total, filePath) => total + bytesForFile(filePath),
    0,
  );
}

export function getLocalDataSummary(): LocalDataSummary {
  const mediaBytes = bytesForDirectory(getStorageRoot());
  const databaseBytesTotal = databaseBytes();
  const logBytes = bytesForDirectory(getLocalLogDirectory());
  return {
    mediaBytes,
    databaseBytes: databaseBytesTotal,
    logBytes,
    totalBytes: mediaBytes + databaseBytesTotal + logBytes,
  };
}
