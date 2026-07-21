import { db, listDueGenerationJobs, type DbClient } from '../db';
import { advance } from './lifecycle';
import type { AdvanceOutcome } from './state-machine';
import { cleanupStoredImages } from '../storage';
import { logSafeEvent } from '../observability/safe-logger';

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

const DEFAULT_WORKER_BATCH_SIZE = 16;

function workerBatchSize(value: number | undefined): number {
  const parsed = value ?? Number(process.env.WORKER_BATCH_SIZE);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WORKER_BATCH_SIZE;
}

function emptyWorkerRunResult(): WorkerRunResult {
  return {
    scanned: 0,
    advanced: 0,
    retried: 0,
    completed: 0,
    failed: 0,
    unknown: 0,
    cancelled: 0,
    skipped: 0,
  };
}

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
  const pageSize = workerBatchSize(options.batchSize);
  const result = emptyWorkerRunResult();
  const dueBefore = new Date().toISOString();
  let afterId: string | undefined;

  // The page size bounds each Promise fan-out; it is not an admission limit.
  // A stable id cursor drains the jobs that were due when this tick began,
  // without revisiting a row or constructing one unbounded Promise array.
  while (true) {
    const jobs = listDueGenerationJobs(
      dueBefore,
      pageSize,
      client,
      afterId,
    );
    if (jobs.length === 0) break;
    afterId = jobs.at(-1)!.id;

    let unexpectedThrow = false;
    const outcomes = await Promise.all(
      jobs.map(async (job): Promise<AdvanceOutcome> => {
        try {
          return await advance(job, client);
        } catch {
          // advance is expected to persist a safe domain failure. A truly
          // unexpected throw is still a failed worker result, never success.
          unexpectedThrow = true;
          return 'failed';
        }
      }),
    );
    result.scanned += jobs.length;
    for (const outcome of outcomes) result[outcome] += 1;

    // An unexpected throw may have left a row unchanged. Stop this tick and
    // let the durable timer revisit it instead of hiding a possible hot loop.
    if (unexpectedThrow) break;
  }
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
    } catch {
      logSafeEvent({ event: 'worker.tick_failed', code: 'WORKER_TICK_FAILED' });
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
