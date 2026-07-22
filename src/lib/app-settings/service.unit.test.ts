import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ValidationError } from '../errors';

import {
  getAppSettings,
  getImageRetentionPolicy,
  getLocalDataSummary,
  getAppSettingsFilePath,
  readStoredAppSettings,
  updateAppSettings,
} from './index';

describe('app settings', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-settings-test-'));
    process.env.USER_CONFIG_DIR = path.join(tempDir, 'config');
    process.env.LOCAL_STORAGE_DIR = path.join(tempDir, 'media');
    process.env.APP_LOG_DIR = path.join(tempDir, 'logs');
    process.env.DATABASE_URL = `file:${path.join(tempDir, 'app.db')}`;
    delete process.env.IMAGE_RETENTION_DAYS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults to never cleaning media and persists a user-selected retention period', () => {
    expect(getAppSettings()).toEqual({ imageRetentionDays: null });
    expect(getImageRetentionPolicy()).toEqual({ days: 0, enabled: false });

    expect(updateAppSettings({ imageRetentionDays: 7 })).toEqual({ imageRetentionDays: 7 });
    expect(readStoredAppSettings()).toEqual({ version: 1, imageRetentionDays: 7 });
    expect(getImageRetentionPolicy()).toEqual({ days: 7, enabled: true });
    expect(fs.statSync(getAppSettingsFilePath()).mode & 0o777).toBe(0o600);
  });

  it('uses the deployment fallback only until a web setting has been saved', () => {
    process.env.IMAGE_RETENTION_DAYS = '30';
    expect(getAppSettings()).toEqual({ imageRetentionDays: 30 });

    updateAppSettings({ imageRetentionDays: null });
    process.env.IMAGE_RETENTION_DAYS = '7';
    expect(getAppSettings()).toEqual({ imageRetentionDays: null });
  });

  it('rejects invalid retention payloads without writing a settings file', () => {
    for (const payload of [
      {},
      { imageRetentionDays: 0 },
      { imageRetentionDays: 1.5 },
      { imageRetentionDays: 36_501 },
      { imageRetentionDays: '7' },
    ]) {
      expect(() => updateAppSettings(payload)).toThrow(ValidationError);
    }
    expect(fs.existsSync(getAppSettingsFilePath())).toBe(false);
  });

  it('reports local byte totals without returning local paths', () => {
    fs.mkdirSync(process.env.LOCAL_STORAGE_DIR!, { recursive: true });
    fs.mkdirSync(process.env.APP_LOG_DIR!, { recursive: true });
    fs.writeFileSync(path.join(process.env.LOCAL_STORAGE_DIR!, 'image.png'), '1234');
    fs.writeFileSync(path.join(process.env.APP_LOG_DIR!, 'app.jsonl'), '123');
    fs.writeFileSync(path.join(tempDir, 'app.db'), '12');

    expect(getLocalDataSummary()).toEqual({
      mediaBytes: 4,
      databaseBytes: 2,
      logBytes: 3,
      totalBytes: 9,
    });
  });
});
