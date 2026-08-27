import { describe, expect, it } from 'vitest';
import { makeProviderCapabilities } from '../../../tests/factories';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  modelCapabilityMap,
  unsupportedModelSubmitResult,
} from './model-spec';

describe('provider model specifications', () => {
  it('projects private profiles into public capabilities', () => {
    const specs = defineProviderModelSpecs([
      {
        capabilities: makeProviderCapabilities({ model: 'model-a' }),
        profile: { kind: 'private-profile' as const },
      },
    ]);

    expect(modelCapabilities(specs)).toEqual([
      expect.objectContaining({ model: 'model-a' }),
    ]);
    expect(modelCapabilityMap(specs).get('model-a')).toMatchObject({ model: 'model-a' });
    expect(JSON.stringify(modelCapabilities(specs))).not.toContain('private-profile');
  });

  it('rejects duplicate model identifiers during provider initialization', () => {
    expect(() => defineProviderModelSpecs([
      {
        capabilities: makeProviderCapabilities({ model: 'duplicate' }),
        profile: { kind: 'first' as const },
      },
      {
        capabilities: makeProviderCapabilities({ model: 'duplicate' }),
        profile: { kind: 'second' as const },
      },
    ])).toThrow('duplicate model IDs');
  });

  it('returns a uniform non-billable error for unknown models', () => {
    expect(unsupportedModelSubmitResult('fal')).toEqual({
      kind: 'failed',
      error: {
        code: 'INVALID_REQUEST',
        message: 'Unsupported model for provider fal',
        retryable: false,
        httpStatus: 400,
        disposition: 'not_started',
        diagnostic: {
          providerId: 'fal',
          category: 'model_or_endpoint',
          providerCode: 'unsupported_model',
        },
      },
    });
  });
});
