import { RateLimitError } from '../errors';

let activeGenerations = 0;

function maxInflightGenerations(): number {
  const parsed = Number(process.env.MAX_INFLIGHT_GENERATIONS ?? 4);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4;
}

export function acquireGenerationSlot(): () => void {
  if (activeGenerations >= maxInflightGenerations()) {
    throw new RateLimitError('Too many active generations; retry later');
  }
  activeGenerations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeGenerations = Math.max(0, activeGenerations - 1);
  };
}

export function resetGenerationAdmission(): void {
  activeGenerations = 0;
}
