/**
 * The complete HTTP response of a synchronous image API is its generation
 * result, so it has a longer budget than task creation or status polling.
 * Keep this policy server-side and shared so provider adapters cannot drift.
 */
export const SYNC_IMAGE_GENERATION_TIMEOUT_MS = 180_000;
export const MAX_SYNC_IMAGE_GENERATION_TIMEOUT_MS = SYNC_IMAGE_GENERATION_TIMEOUT_MS;

/**
 * Resolves a bounded millisecond budget. Invalid values deliberately fall back
 * to the safe default instead of making a paid generation unbounded.
 */
export function resolveSyncImageGenerationTimeoutMs(
  configuredValue = process.env.SYNC_IMAGE_GENERATION_TIMEOUT_MS,
): number {
  if (!configuredValue || !/^\d+$/.test(configuredValue)) {
    return SYNC_IMAGE_GENERATION_TIMEOUT_MS;
  }

  const timeoutMs = Number(configuredValue);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_SYNC_IMAGE_GENERATION_TIMEOUT_MS
  ) {
    return SYNC_IMAGE_GENERATION_TIMEOUT_MS;
  }
  return timeoutMs;
}
