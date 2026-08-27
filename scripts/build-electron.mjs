import path from 'node:path';
import fs from 'node:fs';

import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');

await build({
  absWorkingDir: projectRoot,
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    'migrate-db': 'scripts/migrate-db.mjs',
  },
  outdir: '.desktop-build',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  packages: 'bundle',
  external: ['electron', 'better-sqlite3'],
  logOverride: {
    'empty-import-meta': 'silent',
  },
  logLevel: 'info',
});

const rootPackage = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);
const desktopPackage = {
  name: 'open-image-generator',
  productName: 'open image generator',
  version: rootPackage.version,
  description: rootPackage.description,
  private: true,
  main: 'main.cjs',
};
fs.writeFileSync(
  path.join(projectRoot, '.desktop-build', 'package.json'),
  `${JSON.stringify(desktopPackage, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(projectRoot, '.desktop-build', 'package-lock.json'),
  `${JSON.stringify(
    {
      name: desktopPackage.name,
      version: desktopPackage.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: desktopPackage.name,
          version: desktopPackage.version,
        },
      },
    },
    null,
    2,
  )}\n`,
);
