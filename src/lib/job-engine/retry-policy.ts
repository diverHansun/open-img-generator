export type RetryOperation = 'poll' | 'cancel';

export type PersistedRetryState = {
  attemptCount: number;
  retryStartedAt: string | null;
};

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  capDelayMs: number;
  elapsedBudgetMs: number;
};

export const RETRY_POLICIES: Readonly<Record<RetryOperation, RetryPolicy>> = {
  poll: {
    maxAttempts: 6,
    baseDelayMs: 2_000,
    capDelayMs: 60_000,
    elapsedBudgetMs: 10 * 60_000,
  },
  cancel: {
    maxAttempts: 3,
    baseDelayMs: 1_000,
    capDelayMs: 10_000,
    elapsedBudgetMs: 30_000,
  },
};

export type RetryDecision =
  | {
      kind: 'scheduled';
      attemptCount: number;
      retryStartedAt: string;
      delayMs: number;
      nextAttemptAt: string;
    }
  | {
      kind: 'exhausted';
      reason: 'attempt_limit' | 'elapsed_budget' | 'invalid_state';
    };

export type RetryDecisionOptions = {
  now?: () => number;
  random?: () => number;
};

const JITTER_FLOOR_MS = 250;

/** Shared terminal/success patch. Retry state is phase-local, never historical. */
export function resetRetryState(): Pick<
  PersistedRetryState,
  'attemptCount' | 'retryStartedAt'
> {
  return { attemptCount: 0, retryStartedAt: null };
}

/**
 * Full jitter with a small floor prevents immediate retry storms while keeping
 * the calculation deterministic when callers inject a random source.
 */
export function fullJitterDelayMs(upperBoundMs: number, random: number): number {
  const upperBound = Math.max(JITTER_FLOOR_MS, Math.floor(upperBoundMs));
  const normalizedRandom = Number.isFinite(random)
    ? Math.min(1, Math.max(0, random))
    : 0;
  return Math.floor(
    JITTER_FLOOR_MS + (upperBound - JITTER_FLOOR_MS) * normalizedRandom,
  );
}

function parseRetryStart(value: string | null, nowMs: number): number | null {
  if (value === null) return nowMs;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > nowMs) return null;
  return parsed;
}

/**
 * Decides whether the retryable failure currently being handled can be
 * scheduled. `attemptCount` is the number of prior retryable failures in the
 * current phase, so reaching the configured maximum never schedules a further
 * provider call.
 */
export function decideRetry(
  operation: RetryOperation,
  state: PersistedRetryState,
  options: RetryDecisionOptions = {},
): RetryDecision {
  const nowMs = (options.now ?? Date.now)();
  if (!Number.isFinite(nowMs)) return { kind: 'exhausted', reason: 'invalid_state' };
  if (!Number.isInteger(state.attemptCount) || state.attemptCount < 0) {
    return { kind: 'exhausted', reason: 'invalid_state' };
  }
  // A retry window is an all-or-nothing durable checkpoint. Accepting only
  // half of it after a partial/manual DB edit would silently grant a fresh
  // budget and can turn a bounded retry loop into an unbounded one.
  if (
    (state.attemptCount === 0 && state.retryStartedAt !== null) ||
    (state.attemptCount > 0 && state.retryStartedAt === null)
  ) {
    return { kind: 'exhausted', reason: 'invalid_state' };
  }

  const retryStartedAtMs = parseRetryStart(state.retryStartedAt, nowMs);
  if (retryStartedAtMs === null) {
    return { kind: 'exhausted', reason: 'invalid_state' };
  }

  const policy = RETRY_POLICIES[operation];
  const attemptCount = state.attemptCount + 1;
  if (attemptCount >= policy.maxAttempts) {
    return { kind: 'exhausted', reason: 'attempt_limit' };
  }
  if (nowMs - retryStartedAtMs >= policy.elapsedBudgetMs) {
    return { kind: 'exhausted', reason: 'elapsed_budget' };
  }

  const upperBoundMs = Math.min(
    policy.capDelayMs,
    policy.baseDelayMs * (2 ** (attemptCount - 1)),
  );
  const delayMs = fullJitterDelayMs(upperBoundMs, (options.random ?? Math.random)());
  const deadlineMs = retryStartedAtMs + policy.elapsedBudgetMs;
  const nextAttemptMs = nowMs + delayMs;
  if (nextAttemptMs > deadlineMs) {
    return { kind: 'exhausted', reason: 'elapsed_budget' };
  }
  return {
    kind: 'scheduled',
    attemptCount,
    retryStartedAt: new Date(retryStartedAtMs).toISOString(),
    delayMs,
    nextAttemptAt: new Date(nextAttemptMs).toISOString(),
  };
}
