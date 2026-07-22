import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import electronPath from 'electron';

const projectRoot = path.resolve(import.meta.dirname, '..');
const arch = process.argv[2] ?? process.arch;
const electronExecutable =
  process.env.DESKTOP_ELECTRON_EXECUTABLE || electronPath;
const runtimeRoot = path.join(projectRoot, '.desktop-runtime', arch);
const runtimeNodeModules = path.join(runtimeRoot, 'node_modules');
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'open-image-generator-desktop-smoke-'),
);

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: runtimeRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Command failed (${code}/${signal}): ${output}`));
    });
  });
}

let server;
let createdRuntimeModuleAlias = false;
try {
  if (!fs.existsSync(path.join(runtimeRoot, 'server.js'))) {
    throw new Error(`Prepared desktop runtime not found for ${arch}`);
  }
  // The packaged runtime uses NODE_PATH because electron-builder excludes any
  // extraResource directory literally named node_modules. Inside the checkout,
  // normal parent lookup would find the repository's Node-ABI dependency before
  // NODE_PATH. A temporary local alias makes this smoke exercise the prepared
  // Electron-ABI dependency instead.
  if (fs.existsSync(runtimeNodeModules)) {
    throw new Error(`Unexpected prepared runtime path exists: ${runtimeNodeModules}`);
  }
  fs.symlinkSync('runtime-modules', runtimeNodeModules, 'dir');
  createdRuntimeModuleAlias = true;
  const port = await availablePort();
  const authToken = crypto.randomBytes(32).toString('base64url');
  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_PATH: path.join(runtimeRoot, 'runtime-modules'),
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    DATABASE_URL: `file:${path.join(temporaryRoot, 'app.db')}`,
    LOCAL_STORAGE_DIR: path.join(temporaryRoot, 'images'),
    USER_CONFIG_DIR: path.join(temporaryRoot, 'config'),
    APP_LOG_DIR: path.join(temporaryRoot, 'logs'),
    APP_AUTH_TOKEN: authToken,
    USER_CONFIG_STORAGE_MODE: 'encrypted-file',
    USER_CONFIG_ENCRYPTION_KEY: 'desktop-smoke-master-secret',
    NEXT_TELEMETRY_DISABLED: '1',
  };

  await run(
    electronExecutable,
    [path.join(runtimeRoot, 'scripts', 'migrate-db.cjs')],
    environment,
  );

  server = spawn(electronExecutable, [path.join(runtimeRoot, 'server.js')], {
    cwd: runtimeRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk;
  });

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Desktop runtime exited early: ${serverOutput}`);
    }
    try {
      const response = await fetch(`${origin}/api/health/live`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Wait for the local listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!healthy) throw new Error(`Desktop runtime did not become healthy: ${serverOutput}`);

  const unauthorized = await fetch(`${origin}/api/settings`);
  if (unauthorized.status !== 401) {
    throw new Error(`Expected unauthenticated settings to return 401, got ${unauthorized.status}`);
  }
  const authorized = await fetch(`${origin}/api/settings`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!authorized.ok) {
    throw new Error(`Authenticated settings failed with ${authorized.status}`);
  }
  const body = await authorized.json();
  if (body.app?.version !== '0.1.0' || body.localData?.mediaBytes !== 0) {
    throw new Error(`Unexpected desktop settings payload: ${JSON.stringify(body)}`);
  }

  console.info(`Desktop runtime smoke passed for ${arch} at ${origin}`);
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
  }
  if (createdRuntimeModuleAlias) {
    fs.rmSync(runtimeNodeModules, { force: true });
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
