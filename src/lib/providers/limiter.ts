export const DEFAULT_PROVIDER_QUEUE_LIMIT = 32;
export const DEFAULT_PROVIDER_QUEUE_TIMEOUT_MS = 30_000;

export type ProviderLimiterOptions = {
  signal?: AbortSignal;
  /** Maximum time this invocation may wait before the Provider call starts. */
  timeoutMs?: number;
  /** Allows a caller to lower the per-provider queue capacity for a call. */
  maxQueue?: number;
};

export type ProviderQueueErrorCode =
  | 'QUEUE_SATURATED'
  | 'QUEUE_TIMEOUT'
  | 'QUEUE_ABORTED';

/**
 * A queue failure occurs before the wrapped task is invoked, so dispatch can
 * safely retry it without replaying a billable provider request.
 */
export class ProviderQueueError extends Error {
  public readonly disposition = 'not_started' as const;
  public readonly retryable = true;

  constructor(public readonly code: ProviderQueueErrorCode) {
    super(
      code === 'QUEUE_SATURATED'
        ? 'Provider queue is saturated'
        : 'Provider queue did not start the request',
    );
    this.name = 'ProviderQueueError';
  }
}

type QueueItem<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  started: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type Bucket = {
  active: number;
  queue: QueueItem<any>[];
};

const buckets = new Map<string, Bucket>();

function maxConcurrency(): number {
  const parsed = Number(process.env.MAX_INFLIGHT_PER_PROVIDER ?? 2);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function maxQueue(options: ProviderLimiterOptions): number {
  if (options.maxQueue !== undefined) {
    return Number.isInteger(options.maxQueue) && options.maxQueue >= 0
      ? options.maxQueue
      : DEFAULT_PROVIDER_QUEUE_LIMIT;
  }
  return positiveInteger(
    process.env.MAX_QUEUED_PER_PROVIDER,
    DEFAULT_PROVIDER_QUEUE_LIMIT,
  );
}

function queueTimeoutMs(options: ProviderLimiterOptions): number {
  if (options.timeoutMs !== undefined) {
    return Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : DEFAULT_PROVIDER_QUEUE_TIMEOUT_MS;
  }
  const configured = Number(process.env.PROVIDER_QUEUE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_PROVIDER_QUEUE_TIMEOUT_MS;
}

function getBucket(providerId: string): Bucket {
  const existing = buckets.get(providerId);
  if (existing) return existing;
  const created: Bucket = { active: 0, queue: [] };
  buckets.set(providerId, created);
  return created;
}

function removeIdleBucket(providerId: string, bucket: Bucket): void {
  if (
    bucket.active === 0 &&
    bucket.queue.length === 0 &&
    buckets.get(providerId) === bucket
  ) {
    buckets.delete(providerId);
  }
}

async function drain(providerId: string): Promise<void> {
  const bucket = getBucket(providerId);
  while (bucket.active < maxConcurrency() && bucket.queue.length > 0) {
    const item = bucket.queue.shift()!;
    if (item.started) continue;
    item.started = true;
    cleanupWaitingItem(item);
    bucket.active += 1;
    void Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        bucket.active -= 1;
        void drain(providerId);
        removeIdleBucket(providerId, bucket);
      });
  }
}

function cleanupWaitingItem(item: QueueItem<any>): void {
  if (item.timeout) {
    clearTimeout(item.timeout);
    item.timeout = null;
  }
  if (item.signal && item.onAbort) {
    item.signal.removeEventListener('abort', item.onAbort);
  }
  item.onAbort = undefined;
}

function rejectQueuedItem(
  providerId: string,
  item: QueueItem<any>,
  error: ProviderQueueError,
): void {
  const bucket = getBucket(providerId);
  const index = bucket.queue.indexOf(item);
  if (index < 0 || item.started) return;
  bucket.queue.splice(index, 1);
  cleanupWaitingItem(item);
  item.reject(error);
  removeIdleBucket(providerId, bucket);
}

export function withProviderLimit<T>(
  providerId: string,
  task: () => Promise<T>,
  options: ProviderLimiterOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const bucket = getBucket(providerId);
    if (options.signal?.aborted) {
      reject(new ProviderQueueError('QUEUE_ABORTED'));
      removeIdleBucket(providerId, bucket);
      return;
    }
    // Queue capacity applies only when no concurrency slot is available. A
    // capacity of zero means "start immediately or reject", not "reject an
    // idle provider forever".
    if (
      bucket.active >= maxConcurrency() &&
      bucket.queue.length >= maxQueue(options)
    ) {
      reject(new ProviderQueueError('QUEUE_SATURATED'));
      removeIdleBucket(providerId, bucket);
      return;
    }
    const item: QueueItem<T> = {
      task,
      resolve,
      reject,
      started: false,
      timeout: null,
      signal: options.signal,
    };
    item.timeout = setTimeout(() => {
      rejectQueuedItem(providerId, item, new ProviderQueueError('QUEUE_TIMEOUT'));
    }, queueTimeoutMs(options));
    if (options.signal) {
      item.onAbort = () => {
        rejectQueuedItem(providerId, item, new ProviderQueueError('QUEUE_ABORTED'));
      };
      options.signal.addEventListener('abort', item.onAbort, { once: true });
    }
    bucket.queue.push(item);
    void drain(providerId);
  });
}

export function resetProviderLimiters(): void {
  for (const [providerId, bucket] of buckets) {
    for (const item of [...bucket.queue]) {
      rejectQueuedItem(providerId, item, new ProviderQueueError('QUEUE_ABORTED'));
    }
  }
  buckets.clear();
}
