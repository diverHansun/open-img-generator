import { describe, expect, it } from 'vitest';

import {
  HOME_ROUTE,
  providerDetailRoute,
  workspaceRoute,
} from './routes';

describe('frontend route builders', () => {
  it('keeps the home route stable', () => {
    expect(HOME_ROUTE).toBe('/');
  });

  it('encodes the project identity before appending a workspace section', () => {
    expect(workspaceRoute('project/one', 'generate')).toBe(
      '/workspace/project%2Fone/generate',
    );
  });

  it('encodes project and provider identities independently', () => {
    expect(providerDetailRoute('project/one', 'provider two')).toBe(
      '/workspace/project%2Fone/providers/provider%20two',
    );
  });
});
