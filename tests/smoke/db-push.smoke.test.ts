import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('db migration smoke', () => {
  it('drizzle-kit push creates expected tables', () => {
    const tempFile = path.join(os.tmpdir(), `ai-image-db-push-${Date.now()}.db`);

    try {
      execSync('npm run db:push', {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: `file:${tempFile}`,
        },
        timeout: 60_000,
      });

      const sqlite = require('better-sqlite3')(tempFile);
      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      const names = tables.map((t: { name: string }) => t.name);
      expect(names).toContain('sessions');
      expect(names).toContain('projects');
      expect(names).toContain('generations');
      expect(names).toContain('generation_jobs');
      expect(names).toContain('images');
      expect(names).toContain('favorites');
      expect(names).toContain('model_preferences');
      sqlite.close();
    } finally {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // ignore
      }
    }
  });
});
