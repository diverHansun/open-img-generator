import type { GenerationView } from './types';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function areAllJobsTerminal(view: GenerationView): boolean {
  return (
    view.jobs.length > 0 &&
    view.jobs.every((job) => TERMINAL_STATUSES.has(job.status))
  );
}
