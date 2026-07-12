import { describe, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

describe('build smoke', () => {
  it('next build succeeds', () => {
    execSync('npm run build', {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: 120_000,
    });
  });
});
