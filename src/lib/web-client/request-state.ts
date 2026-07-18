export type LatestRequestResult<T> =
  | { state: 'current'; value: T }
  | { state: 'stale' };

/**
 * Prevents an older page/filter request from overwriting a newer one and
 * aborts the browser fetch that is no longer relevant.
 */
export class LatestRequestCoordinator {
  private currentToken = 0;
  private currentAbortController: AbortController | undefined;

  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<LatestRequestResult<T>> {
    const token = this.currentToken + 1;
    this.currentToken = token;
    this.currentAbortController?.abort();
    const controller = new AbortController();
    this.currentAbortController = controller;
    try {
      const value = await operation(controller.signal);
      return this.currentToken === token && !controller.signal.aborted
        ? { state: 'current', value }
        : { state: 'stale' };
    } catch (error) {
      if (this.currentToken !== token || controller.signal.aborted) {
        return { state: 'stale' };
      }
      throw error;
    } finally {
      if (this.currentToken === token) {
        this.currentAbortController = undefined;
      }
    }
  }

  cancel(): void {
    this.currentToken += 1;
    this.currentAbortController?.abort();
    this.currentAbortController = undefined;
  }
}
