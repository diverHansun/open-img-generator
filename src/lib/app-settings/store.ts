import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getUserConfigDirectory } from '../user-config/paths';

import {
  APP_SETTINGS_VERSION,
  MAX_IMAGE_RETENTION_DAYS,
  type AppSettings,
  type StoredAppSettings,
} from './types';

export function getAppSettingsFilePath(): string {
  return path.join(getUserConfigDirectory(), 'settings.json');
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

function parseStoredAppSettings(value: unknown): StoredAppSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid app settings');
  }
  const input = value as Record<string, unknown>;
  if (input.version !== APP_SETTINGS_VERSION) {
    throw new Error('Unsupported app settings version');
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'imageRetentionDays') &&
    !isRetentionDays(input.imageRetentionDays)
  ) {
    throw new Error('Invalid image retention setting');
  }
  return {
    version: APP_SETTINGS_VERSION,
    ...(Object.prototype.hasOwnProperty.call(input, 'imageRetentionDays')
      ? { imageRetentionDays: input.imageRetentionDays as number | null }
      : {}),
  };
}

/**
 * A missing or malformed non-secret settings file safely behaves as absent.
 * A subsequent successful save replaces malformed content atomically.
 */
export function readStoredAppSettings(): StoredAppSettings | undefined {
  const filePath = getAppSettingsFilePath();
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return parseStoredAppSettings(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    console.warn('[app-settings] settings file is unavailable; using defaults');
    return undefined;
  }
}

export function writeAppSettings(settings: AppSettings): void {
  const normalized: StoredAppSettings = {
    version: APP_SETTINGS_VERSION,
    imageRetentionDays: settings.imageRetentionDays,
  };
  if (!isRetentionDays(normalized.imageRetentionDays)) {
    throw new Error('Invalid image retention setting');
  }

  const directory = getUserConfigDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);

  const filePath = getAppSettingsFilePath();
  const temporaryPath = path.join(
    directory,
    `.settings.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // An interrupted write must not hide the original write error.
    }
  }
}
