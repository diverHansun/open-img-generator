import { db, listDueGenerationJobs, type DbClient } from '../db';
import { advance } from './lifecycle';
import type { AdvanceOutcome } from './state-machine';
import { cleanupStoredImages } from '../storage';

export type WorkerOptions = {
  db?: DbClient;
  batchSize?: number;
};

export type WorkerRunResult = {
  scanned: number;
  advanced: number;
  retried: number;
  completed: number;
  failed: number;
  unknown: number;
  cancelled: number;
  skipped: number;
};

/**
 * Starts the optional in-process worker from a Node API entrypoint. Next's
 * instrumentation bundle also runs in an Edge build during `next build`, so
 * importing the Node-only worker there is not reliable; route handlers call
 * this bootstrap instead once the Node server is handling requests.
 */
export function ensureWorkerStarted(): void {
  if (process.env.JOB_WORKER_ENABLED === 'false') return;
  const globalState = globalThis as typeof globalThis & {
    __openImageGeneratorWorkerStop?: () => void;
  };
  if (globalState.__openImageGeneratorWorkerStop) return;
  const stop = startWorker();
  globalState.__openImageGeneratorWorkerStop = () => {
    stop();
    delete globalState.__openImageGeneratorWorkerStop;
  };
}

/** Lets integration tests and controlled shutdowns release the singleton timer. */
export function stopWorker(): void {
  const globalState = globalThis as typeof globalThis & {
    __openImageGeneratorWorkerStop?: () => void;
  };
  globalState.__openImageGeneratorWorkerStop?.();
}

export async function runWorkerOnce(options: WorkerOptions = {}): Promise<{
  scanned: number;
  advanced: number;
  retried: number;
  completed: number;
  failed: number;
  unknown: number;
  cancelled: number;
  skipped: number;
}> {
  const client = options.db ?? db;
  const jobs = listDueGenerationJobs(
    new Date().toISOString(),
    options.batchSize ?? Number(process.env.WORKER_BATCH_SIZE ?? 16),
    client,
  );
  const outcomes = await Promise.all(
    jobs.map(async (job): Promise<AdvanceOutcome> => {
      try {
        return await advance(job, client);
      } catch {
        // advance is expected to persist a safe domain failure. A truly
        // unexpected throw is still a failed worker result, never success.
        return 'failed';
      }
    }),
  );
  const result: WorkerRunResult = {
    scanned: jobs.length,
    advanced: 0,
    retried: 0,
    completed: 0,
    failed: 0,
    unknown: 0,
    cancelled: 0,
    skipped: 0,
  };
  for (const outcome of outcomes) result[outcome] += 1;
  return result;
}

export function startWorker(options: WorkerOptions = {}): () => void {
  const client = options.db ?? db;
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5_000);
  let stopped = false;
  let running = false;
  let lastCleanupAt = 0;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runWorkerOnce(options);
      const cleanupInterval = Number(process.env.IMAGE_CLEANUP_INTERVAL_MS ?? 3_600_000);
      if (Date.now() - lastCleanupAt >= cleanupInterval) {
        cleanupStoredImages({ db: client });
        lastCleanupAt = Date.now();
      }
    } catch (err) {
      console.error('[job-worker] tick failed', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs > 0 ? intervalMs : 5_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
