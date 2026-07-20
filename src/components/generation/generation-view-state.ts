import type { GenerationStatus, GenerationView } from '@/lib/web-client';

const TERMINAL_STATUSES = new Set<GenerationStatus>([
  'completed',
  'failed',
  'cancelled',
]);

function statusRank(status: GenerationStatus): number {
  if (status === 'pending') return 0;
  if (status === 'running') return 1;
  return 2;
}

function compareUpdatedAt(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return Math.sign(leftTime - rightTime);
  }
  return left.localeCompare(right);
}

function statusRegresses(current: GenerationStatus, incoming: GenerationStatus) {
  if (statusRank(incoming) < statusRank(current)) return true;
  return TERMINAL_STATUSES.has(current) && incoming !== current;
}

function losesStoredProgress(current: GenerationView, incoming: GenerationView) {
  if (statusRegresses(current.status, incoming.status)) return true;

  const incomingJobs = new Map(incoming.jobs.map((job) => [job.id, job]));
  for (const currentJob of current.jobs) {
    const incomingJob = incomingJobs.get(currentJob.id);
    if (!incomingJob || statusRegresses(currentJob.status, incomingJob.status)) {
      return true;
    }
  }

  const incomingImageIds = new Set(incoming.images.map((image) => image.id));
  return current.images.some((image) => !incomingImageIds.has(image.id));
}

/**
 * Generation state is monotonic. Ignore an older response, or an equal/newer
 * response that would move a terminal job backwards or drop an emitted image.
 */
export function reconcileGenerationSnapshot(
  current: GenerationView | null,
  incoming: GenerationView,
): GenerationView {
  if (!current || current.id !== incoming.id || current.projectId !== incoming.projectId) {
    return incoming;
  }
  if (compareUpdatedAt(incoming.updatedAt, current.updatedAt) < 0) return current;
  if (losesStoredProgress(current, incoming)) return current;
  return incoming;
}
