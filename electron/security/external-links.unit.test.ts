import { describe, expect, it } from 'vitest';

import { providerMetadata } from '../../src/lib/provider-config/provider-metadata';
import { isAllowedExternalUrl } from './external-links';

describe('desktop external link policy', () => {
  it('allows only product-owned Provider and license destinations', () => {
    for (const provider of providerMetadata) {
      expect(isAllowedExternalUrl(provider.keyApplyUrl)).toBe(true);
    }
    expect(
      isAllowedExternalUrl('https://www.apache.org/licenses/LICENSE-2.0'),
    ).toBe(true);
  });

  it('rejects unknown, modified, credentialed, and non-HTTPS URLs', () => {
    expect(isAllowedExternalUrl('https://example.com/')).toBe(false);
    expect(isAllowedExternalUrl('https://fal.ai/dashboard/keys?redirect=1')).toBe(
      false,
    );
    expect(isAllowedExternalUrl('https://user:pass@fal.ai/dashboard/keys')).toBe(
      false,
    );
    expect(isAllowedExternalUrl('http://fal.ai/dashboard/keys')).toBe(false);
    expect(isAllowedExternalUrl('not-a-url')).toBe(false);
  });
});
