import 'client-only';

import { createApiClient, type ApiClient } from './api-client';
import { GenerationPollRegistry } from './poll-registry';

export type BrowserWebClientRuntime = Readonly<{
  client: ApiClient;
  generationPollRegistry: GenerationPollRegistry;
}>;

let runtime: BrowserWebClientRuntime | undefined;

/**
 * Returns the one transient browser runtime shared by page components.
 * The registry owns active poll schedules only; it is not a cross-page data cache.
 */
export function getBrowserWebClientRuntime(): BrowserWebClientRuntime {
  if (!runtime) {
    const client = createApiClient();
    runtime = {
      client,
      generationPollRegistry: new GenerationPollRegistry(client),
    };
  }
  return runtime;
}
