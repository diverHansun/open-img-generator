import { describe, expect, it } from 'vitest';

import type { ProviderConfiguration } from '@/lib/web-client';

import {
  findProviderConfiguration,
  getProviderMarkText,
  getProviderModelCount,
} from './provider-view';

const configuration: ProviderConfiguration = {
  providerId: 'fal',
  displayName: 'fal.ai',
  credentialName: 'FAL_KEY',
  configured: true,
  source: 'user-config',
  models: [],
  enabledModelCount: 1,
  availableModelCount: 2,
  editable: true,
  keyApplyUrl: 'https://fal.ai/dashboard/keys',
};

describe('provider view helpers', () => {
  it('does not present an enabled count for an unconfigured provider', () => {
    expect(
      getProviderModelCount({
        ...configuration,
        configured: false,
        source: 'none',
        enabledModelCount: 2,
      }),
    ).toEqual({ configured: false, total: 2 });
  });

  it('uses the server summary for configured model counts', () => {
    expect(getProviderModelCount(configuration)).toEqual({
      configured: true,
      enabled: 1,
      total: 2,
    });
  });

  it('matches only the exact provider identifier', () => {
    expect(findProviderConfiguration([configuration], 'fal')).toBe(configuration);
    expect(findProviderConfiguration([configuration], 'FAL')).toBeUndefined();
  });

  it('builds a compact neutral mark from the display name', () => {
    expect(getProviderMarkText('Silicon Flow')).toBe('SF');
    expect(getProviderMarkText('Qwen')).toBe('QW');
  });
});
