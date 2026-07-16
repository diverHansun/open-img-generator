type QueueItem<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
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

function getBucket(providerId: string): Bucket {
  const existing = buckets.get(providerId);
  if (existing) return existing;
  const created: Bucket = { active: 0, queue: [] };
  buckets.set(providerId, created);
  return created;
}

async function drain(providerId: string): Promise<void> {
  const bucket = getBucket(providerId);
  while (bucket.active < maxConcurrency() && bucket.queue.length > 0) {
    const item = bucket.queue.shift()!;
    bucket.active += 1;
    void item.task().then(item.resolve, item.reject).finally(() => {
      bucket.active -= 1;
      void drain(providerId);
    });
  }
}

export function withProviderLimit<T>(
  providerId: string,
  task: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const bucket = getBucket(providerId);
    bucket.queue.push({ task, resolve, reject });
    void drain(providerId);
  });
}

export function resetProviderLimiters(): void {
  buckets.clear();
}
