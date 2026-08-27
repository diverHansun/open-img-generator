import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('build smoke', () => {
  it('next build succeeds', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const distDirName = `.next-smoke-${randomUUID()}`;
    const distDir = path.join(projectRoot, distDirName);
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const originalTsconfig = fs.readFileSync(tsconfigPath, 'utf8');
    try {
      execSync('npm run build', {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_SMOKE_DIST_DIR: distDirName,
        },
        timeout: 120_000,
      });
      expect(fs.existsSync(distDir)).toBe(true);
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.writeFileSync(tsconfigPath, originalTsconfig);
    }
  });
});
