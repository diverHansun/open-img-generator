import { spawn } from 'node:child_process';
import path from 'node:path';

import { prepareDesktopRuntime } from './prepare-desktop-runtime.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const requestedArchitectures = process.argv.slice(2);
const architectures =
  requestedArchitectures.length > 0 ? requestedArchitectures : [process.arch];

function run(command, args, environment = process.env, cwd = projectRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code} signal ${signal}`));
    });
  });
}

await run('npm', ['run', 'build']);
await run('npm', ['run', 'desktop:compile']);

for (const arch of architectures) {
  await prepareDesktopRuntime(arch);
  await run(
    path.join(projectRoot, 'node_modules', '.bin', 'electron-builder'),
    [
      '--config',
      path.join(projectRoot, 'electron-builder.config.cjs'),
      '--mac',
      `--${arch}`,
    ],
    { ...process.env, DESKTOP_TARGET_ARCH: arch },
    path.join(projectRoot, '.desktop-build'),
  );
}
