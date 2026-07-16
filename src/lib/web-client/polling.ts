import type { ApiClient } from './api-client';
import type { GenerationView } from './types';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function areAllJobsTerminal(view: GenerationView): boolean {
  return view.jobs.length > 0 && view.jobs.every((job) => TERMINAL_STATUSES.has(job.status));
}

export type PollingOptions = {
  onUpdate?: (view: GenerationView) => void;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class GenerationPollingController {
  private cancelled = false;

  constructor(private readonly client: Pick<ApiClient, 'getGeneration'>) {}

  cancel(): void {
    this.cancelled = true;
  }

  async start(selfLink: string, options: PollingOptions = {}): Promise<GenerationView | undefined> {
    this.cancelled = false;
    let delayMs = options.initialDelayMs ?? 2_000;
    const maxDelayMs = options.maxDelayMs ?? 5_000;
    const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

    while (!this.cancelled) {
      const view = await this.client.getGeneration(selfLink);
      options.onUpdate?.(view);
      if (areAllJobsTerminal(view)) {
        return view;
      }
      await sleep(delayMs);
      delayMs = Math.min(maxDelayMs, Math.max(delayMs * 2, 2_000));
    }
    return undefined;
  }
}
