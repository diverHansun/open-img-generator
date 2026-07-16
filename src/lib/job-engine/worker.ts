import { db, listDueGenerationJobs, type DbClient } from '../db';
import { advance } from './lifecycle';
import { cleanupStoredImages } from '../storage';

export type WorkerOptions = {
  db?: DbClient;
  batchSize?: number;
};

/**
 * Starts the optional in-process worker from a Node API entrypoint. Next's
 * instrumentation bundle also runs in an Edge build during `next build`, so
 * importing the Node-only worker there is not reliable; route handlers call
 * this bootstrap instead once the Node server is handling requests.
 */
export function ensureWorkerStarted(): void {
  if (process.env.JOB_WORKER_ENABLED !== 'true') return;
  const globalState = globalThis as typeof globalThis & {
    __openImageGeneratorWorkerStop?: () => void;
  };
  if (globalState.__openImageGeneratorWorkerStop) return;
  globalState.__openImageGeneratorWorkerStop = startWorker();
}

export async function runWorkerOnce(options: WorkerOptions = {}): Promise<{
  scanned: number;
  succeeded: number;
  failed: number;
}> {
  const client = options.db ?? db;
  const jobs = listDueGenerationJobs(
    new Date().toISOString(),
    options.batchSize ?? Number(process.env.WORKER_BATCH_SIZE ?? 16),
    client,
  );
  const results = await Promise.allSettled(jobs.map((job) => advance(job, client)));
  return {
    scanned: jobs.length,
    succeeded: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
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
