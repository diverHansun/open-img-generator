import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop compile smoke', () => {
  it('bundles and runs the migration entry in the Electron CommonJS format', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-compile-smoke-'));

    try {
      execFileSync(process.execPath, ['scripts/build-electron.mjs'], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      const migrationEntry = path.join(projectRoot, '.desktop-build', 'migrate-db.cjs');
      expect(fs.existsSync(migrationEntry)).toBe(true);

      const report = JSON.parse(execFileSync(process.execPath, [migrationEntry], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: `file:${path.join(runtimeRoot, 'app.db')}`,
          LOCAL_STORAGE_DIR: path.join(runtimeRoot, 'images'),
          USER_CONFIG_DIR: path.join(runtimeRoot, 'config'),
          APP_LOG_DIR: path.join(runtimeRoot, 'logs'),
        },
      }));
      expect(report.toVersion).toBeGreaterThan(0);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
