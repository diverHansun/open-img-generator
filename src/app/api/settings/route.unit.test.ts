import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GET, PUT } from './route';

describe('/api/settings', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-route-test-'));
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

  it('returns safe local settings metadata and stores a positive retention period', async () => {
    const initial = await GET().json();
    expect(initial).toMatchObject({
      settings: { imageRetentionDays: null },
      webCapabilities: { managesDownloadLocation: false, canOpenDataDirectory: false },
      app: { license: 'Apache-2.0' },
    });
    expect(JSON.stringify(initial)).not.toContain(tempDir);

    const response = await PUT(new Request('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageRetentionDays: 7 }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      settings: { imageRetentionDays: 7 },
    });
    expect(
      fs.readFileSync(path.join(process.env.USER_CONFIG_DIR!, 'settings.json'), 'utf8'),
    ).toContain('"imageRetentionDays":7');
  });

  it('rejects an invalid retention period with a safe validation error', async () => {
    const response = await PUT(new Request('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageRetentionDays: 0 }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'imageRetentionDays must be null or an integer between 1 and 36500',
      },
    });
  });
});
