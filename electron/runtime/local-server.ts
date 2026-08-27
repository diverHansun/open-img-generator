import {
  spawn,
  type ChildProcessByStdio,
} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import type { Readable } from 'node:stream';

type ManagedChild = ChildProcessByStdio<null, Readable, Readable>;

export type RunningLocalServer = {
  origin: string;
  port: number;
  process: ManagedChild;
  stop(): Promise<void>;
};

type StartLocalServerOptions = {
  environment: NodeJS.ProcessEnv;
  development: boolean;
  projectRoot: string;
  resourcesPath: string;
  log(message: string): void;
  onUnexpectedExit?(code: number | null, signal: NodeJS.Signals | null): void;
};

const STARTUP_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export async function findAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (port > 0) resolve(port);
        else reject(new Error('Could not allocate a loopback port'));
      });
    });
  });
}

function attachLogs(
  child: ManagedChild,
  log: (message: string) => void,
  label: string,
): void {
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      log(`[${label}:stdout] ${line}`);
    }
  });
  child.stderr.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      log(`[${label}:stderr] ${line}`);
    }
  });
}

function waitForCommand(
  child: ManagedChild,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} timed out`));
    }, STARTUP_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code} signal ${signal}`));
    });
  });
}

async function waitForHealth(
  origin: string,
  child: ManagedChild,
): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Local runtime exited before becoming healthy');
    }
    try {
      const response = await fetch(`${origin}/api/health/live`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The port is not accepting requests yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Local runtime health check timed out');
}

async function stopChild(child: ManagedChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function startLocalServer(
  options: StartLocalServerOptions,
): Promise<RunningLocalServer> {
  const runtimeRoot = options.development
    ? options.projectRoot
    : path.join(options.resourcesPath, 'app-runtime');
  const electronNodeEnvironment = options.development
    ? options.environment
    : {
        ...options.environment,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: path.join(runtimeRoot, 'runtime-modules'),
      };
  const nodeExecutable = options.development ? 'node' : process.execPath;
  const migrationPath = path.join(
    runtimeRoot,
    'scripts',
    options.development ? 'migrate-db.mjs' : 'migrate-db.cjs',
  );

  options.log('Running desktop database migration');
  const migration = spawn(nodeExecutable, [migrationPath], {
    cwd: runtimeRoot,
    env: electronNodeEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  attachLogs(migration, options.log, 'migration');
  await waitForCommand(migration, 'Database migration');

  const port = Number(options.environment.PORT);
  const origin = `http://127.0.0.1:${port}`;
  const serverArguments = options.development
    ? [
        path.join(runtimeRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
        'dev',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ]
    : [path.join(runtimeRoot, 'server.js')];

  options.log(`Starting local runtime at ${origin}`);
  const child = spawn(nodeExecutable, serverArguments, {
    cwd: runtimeRoot,
    env: electronNodeEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  attachLogs(child, options.log, 'next');

  try {
    await waitForHealth(origin, child);
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  let stopping = false;
  child.once('exit', (code, signal) => {
    options.log(`Local runtime exited with code ${code} signal ${signal}`);
    if (!stopping) options.onUnexpectedExit?.(code, signal);
  });

  return {
    origin,
    port,
    process: child,
    async stop() {
      stopping = true;
      await stopChild(child);
    },
  };
}
