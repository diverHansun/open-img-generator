import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

/** Registers strict, per-file MSW lifecycle hooks for integration tests. */
export function registerMswLifecycle(): void {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });
}
