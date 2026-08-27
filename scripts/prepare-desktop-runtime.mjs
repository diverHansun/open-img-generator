import fs from 'node:fs';
import path from 'node:path';

import { rebuild } from '@electron/rebuild';

const projectRoot = path.resolve(import.meta.dirname, '..');
const electronVersion = '43.2.0';

function copyDirectoryIfPresent(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, destination, { recursive: true });
}

export async function prepareDesktopRuntime(arch) {
  if (!['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported macOS architecture: ${arch}`);
  }
  const standaloneDirectory = path.join(
    projectRoot,
    '.next-build',
    'standalone',
  );
  if (!fs.existsSync(path.join(standaloneDirectory, 'server.js'))) {
    throw new Error('Next standalone output is missing; run npm run build first');
  }

  const runtimeDirectory = path.join(projectRoot, '.desktop-runtime', arch);
  fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  fs.cpSync(standaloneDirectory, runtimeDirectory, { recursive: true });
  copyDirectoryIfPresent(
    path.join(projectRoot, '.next-build', 'static'),
    path.join(runtimeDirectory, '.next-build', 'static'),
  );
  copyDirectoryIfPresent(
    path.join(projectRoot, 'public'),
    path.join(runtimeDirectory, 'public'),
  );
  fs.mkdirSync(path.join(runtimeDirectory, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, '.desktop-build', 'migrate-db.cjs'),
    path.join(runtimeDirectory, 'scripts', 'migrate-db.cjs'),
  );
  const manifestDestination = path.join(
    runtimeDirectory,
    'src',
    'lib',
    'db',
    'schema-manifest.json',
  );
  fs.mkdirSync(path.dirname(manifestDestination), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, 'src', 'lib', 'db', 'schema-manifest.json'),
    manifestDestination,
  );

  // Next output tracing keeps the already-built native binary but omits the
  // binding sources. Replace that traced package with the complete dependency
  // before rebuilding it for Electron's Node ABI.
  const runtimeSqlite = path.join(
    runtimeDirectory,
    'node_modules',
    'better-sqlite3',
  );
  fs.rmSync(runtimeSqlite, { recursive: true, force: true });
  fs.cpSync(
    path.join(projectRoot, 'node_modules', 'better-sqlite3'),
    runtimeSqlite,
    { recursive: true },
  );

  await rebuild({
    buildPath: runtimeDirectory,
    electronVersion,
    arch,
    onlyModules: ['better-sqlite3'],
    force: true,
  });
  fs.renameSync(
    path.join(runtimeDirectory, 'node_modules'),
    path.join(runtimeDirectory, 'runtime-modules'),
  );
  return runtimeDirectory;
}

if (process.argv[1] === import.meta.filename) {
  await prepareDesktopRuntime(process.argv[2] ?? process.arch);
}
