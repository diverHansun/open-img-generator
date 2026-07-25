import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../..');
const temporaryRoots: string[] = [];
const children = new Set<ChildProcessWithoutNullStreams>();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForUrl(url: string, child: ChildProcessWithoutNullStreams): Promise<Response> {
  const deadline = Date.now() + 75_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Development server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`, { cause: lastError });
}

function stopProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode === null && child.pid) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
  children.delete(child);
}

async function waitForPortRelease(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Port ${port} was not released after stopping npm run dev`);
}

function startDevelopmentServer(port: number, root: string): ChildProcessWithoutNullStreams {
  const child = spawn('npm.cmd', ['run', 'dev', '--', '--port', String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: `file:${path.join(root, 'database', 'app.db')}`,
      LOCAL_STORAGE_DIR: path.join(root, 'images'),
      USER_CONFIG_DIR: path.join(root, 'config'),
      APP_LOG_DIR: path.join(root, 'logs'),
      NEXT_TELEMETRY_DISABLED: '1',
    },
    windowsHide: true,
    // Node 25 requires a shell for .cmd files. All arguments above are fixed
    // test literals or a numeric OS-assigned port; no user input is evaluated.
    shell: true,
  });
  children.add(child);
  let diagnostics = '';
  const collect = (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-16_000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('exit', (code) => {
    children.delete(child);
    if (code && diagnostics) process.stderr.write(diagnostics);
  });
  return child;
}

afterEach(() => {
  for (const child of children) stopProcessTree(child);
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.runIf(process.platform === 'win32')('Windows development runtime smoke', () => {
  it('starts twice on localhost with the same migrated database and releases the port', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Open Image Generator dev 测试 '));
    temporaryRoots.push(root);
    const port = await freePort();

    for (let launch = 0; launch < 2; launch += 1) {
      const child = startDevelopmentServer(port, root);
      const page = await waitForUrl(`http://localhost:${port}/`, child);
      expect(page.ok).toBe(true);
      const health = await waitForUrl(`http://localhost:${port}/api/health`, child);
      expect(health.ok).toBe(true);
      stopProcessTree(child);
      await waitForPortRelease(port);
    }

    const databasePath = path.join(root, 'database', 'app.db');
    expect(fs.statSync(databasePath).isFile()).toBe(true);
    expect(fs.existsSync(`${databasePath}.migrate-lock.sqlite`)).toBe(true);
  }, 180_000);
});
