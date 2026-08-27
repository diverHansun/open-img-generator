import { describe, expect, it } from 'vitest';

import type {
  ModelPreference,
  ProviderCapabilities,
  ProviderConfiguration,
} from '@/lib/web-client';

import { buildModelGroups, filterModelGroups } from './model-view';

const capability: ProviderCapabilities = {
  providerId: 'fal',
  model: 'fal-ai/flux/schnell',
  displayName: 'FLUX Schnell',
  modes: ['text-to-image'],
  maxCount: 4,
  supportedSizes: ['1024x1024'],
  supportedAspectRatios: ['1:1'],
  supportsNegativePrompt: false,
  supportsSeed: true,
  protocol: 'async',
  defaultSize: '1024x1024',
};

function configuration(
  configured: boolean,
  overrides: Partial<ProviderConfiguration> = {},
): ProviderConfiguration {
  return {
    providerId: 'fal',
    displayName: 'fal.ai',
    credentialName: 'FAL_KEY',
    configured,
    source: configured ? 'env' : 'none',
    models: [capability],
    enabledModelCount: 1,
    availableModelCount: 1,
    editable: !configured,
    keyApplyUrl: 'https://fal.ai/dashboard/keys',
    credentialStorageMode: 'encrypted-file',
    ...overrides,
  };
}

describe('Models view projection', () => {
  it('omits unconfigured providers and treats a missing preference as enabled', () => {
    const groups = buildModelGroups([configuration(false), configuration(true)], []);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows[0]).toMatchObject({ enabled: true, providerId: 'fal' });
  });

  it('uses the persisted preference when one exists', () => {
    const preferences: ModelPreference[] = [
      {
        provider: 'fal',
        model: capability.model,
        enabled: false,
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    ];

    expect(buildModelGroups([configuration(true)], preferences)[0]?.rows[0]?.enabled).toBe(false);
  });

  it('combines provider filtering with case-insensitive name and id search', () => {
    const groups = buildModelGroups([configuration(true)], []);

    expect(filterModelGroups(groups, 'FLUX', 'all')).toHaveLength(1);
    expect(filterModelGroups(groups, 'fal-ai/flux', 'fal')).toHaveLength(1);
    expect(filterModelGroups(groups, 'missing', 'all')).toEqual([]);
  });
});
