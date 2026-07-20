import { ApiClientError, type ApiClient } from './api-client';
import { areAllJobsTerminal } from './polling';
import type { GenerationView } from './types';

export type GenerationPollListener = {
  onUpdate: (view: GenerationView) => void;
  onError?: (error: unknown) => void;
};

export type PollScheduler = {
  setTimeout: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type Entry = {
  generationId: string;
  listeners: Set<GenerationPollListener>;
  delayMs: number;
  timer: unknown | undefined;
  abortController: AbortController | undefined;
  failureCount: number;
};

const browserScheduler: PollScheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function browserAllowsPolling(): boolean {
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return online && visible;
}

/**
 * Shares the one poll-capable detail GET across every visible subscriber for a
 * Generation. It is intentionally transient: terminal views and the final
 * unsubscribe remove the entry instead of becoming a browser data store.
 */
export class GenerationPollRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly client: Pick<ApiClient, 'getGenerationById'>,
    private readonly scheduler: PollScheduler = browserScheduler,
    private readonly initialDelayMs = 2_000,
    private readonly maxDelayMs = 5_000,
    private readonly maxFailures = 6,
    private readonly canPoll: () => boolean = browserAllowsPolling,
  ) {}

  subscribe(
    generationId: string,
    listener: GenerationPollListener,
  ): () => void {
    let entry = this.entries.get(generationId);
    if (!entry) {
      entry = {
        generationId,
        listeners: new Set(),
        delayMs: this.initialDelayMs,
        timer: undefined,
        abortController: undefined,
        failureCount: 0,
      };
      this.entries.set(generationId, entry);
    }
    entry.listeners.add(listener);
    if (!entry.abortController && entry.timer === undefined) {
      void this.poll(entry);
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      entry!.listeners.delete(listener);
      if (entry!.listeners.size === 0) this.stop(entry!);
    };
  }

  subscriptionCount(generationId: string): number {
    return this.entries.get(generationId)?.listeners.size ?? 0;
  }

  private async poll(entry: Entry): Promise<void> {
    if (this.entries.get(entry.generationId) !== entry || entry.listeners.size === 0) {
      return;
    }
    if (!this.canPoll()) {
      this.scheduleNext(entry);
      return;
    }
    const controller = new AbortController();
    entry.abortController = controller;
    try {
      const view = await this.client.getGenerationById(entry.generationId, {
        signal: controller.signal,
      });
      if (!this.isCurrent(entry, controller)) return;
      entry.failureCount = 0;
      for (const listener of entry.listeners) listener.onUpdate(view);
      if (areAllJobsTerminal(view)) {
        this.stop(entry);
        return;
      }
      this.scheduleNext(entry);
      entry.delayMs = Math.min(
        this.maxDelayMs,
        Math.max(entry.delayMs * 2, this.initialDelayMs),
      );
    } catch (error) {
      if (!this.isCurrent(entry, controller) || controller.signal.aborted) return;
      entry.failureCount += 1;
      for (const listener of entry.listeners) listener.onError?.(error);
      if (
        (error instanceof ApiClientError && !error.retryable) ||
        entry.failureCount >= this.maxFailures
      ) {
        this.stop(entry);
        return;
      }
      this.scheduleNext(entry);
      entry.delayMs = Math.min(
        this.maxDelayMs,
        Math.max(entry.delayMs * 2, this.initialDelayMs),
      );
    } finally {
      if (entry.abortController === controller) {
        entry.abortController = undefined;
      }
    }
  }

  private isCurrent(entry: Entry, controller: AbortController): boolean {
    return (
      this.entries.get(entry.generationId) === entry &&
      entry.abortController === controller
    );
  }

  private scheduleNext(entry: Entry): void {
    if (this.entries.get(entry.generationId) !== entry || entry.listeners.size === 0) {
      return;
    }
    entry.timer = this.scheduler.setTimeout(() => {
      entry.timer = undefined;
      void this.poll(entry);
    }, entry.delayMs);
  }

  private stop(entry: Entry): void {
    if (this.entries.get(entry.generationId) !== entry) return;
    if (entry.timer !== undefined) {
      this.scheduler.clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    entry.abortController?.abort();
    entry.abortController = undefined;
    this.entries.delete(entry.generationId);
  }
}
