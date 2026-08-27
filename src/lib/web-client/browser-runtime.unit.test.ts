import { describe, expect, it } from 'vitest';

import { GenerationPollRegistry } from './poll-registry';
import { getBrowserWebClientRuntime } from './browser-runtime';

describe('browser web-client runtime', () => {
  it('shares one API client and one generation poll registry', () => {
    const first = getBrowserWebClientRuntime();
    const second = getBrowserWebClientRuntime();

    expect(second).toBe(first);
    expect(second.client).toBe(first.client);
    expect(second.generationPollRegistry).toBe(first.generationPollRegistry);
    expect(second.generationPollRegistry).toBeInstanceOf(GenerationPollRegistry);
  });
});
