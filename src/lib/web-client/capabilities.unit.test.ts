import { describe, expect, it } from 'vitest';
import {
  buildSubmitGenerationRequest,
  deriveGenerationControls,
} from './capabilities';
import type { ProviderInfo } from './types';

const providers: ProviderInfo[] = [
  {
    id: 'fal',
    displayName: 'fal.ai',
    models: [
      {
        providerId: 'fal', model: 'fal-ai/flux/schnell', displayName: 'FLUX Schnell',
        modes: ['text-to-image'], maxCount: 4, supportedSizes: ['square_hd'],
        supportedAspectRatios: ['1:1', '16:9'], supportsNegativePrompt: false,
        supportsSeed: true, protocol: 'async', defaultSize: 'square_hd',
      },
    ],
  },
  {
    id: 'zenmux',
    displayName: 'ZenMux',
    models: [
      {
        providerId: 'zenmux', model: 'openai/gpt-image-2', displayName: 'GPT Image 2',
        modes: ['text-to-image'], maxCount: 4, supportedSizes: ['1024x1024'],
        supportedAspectRatios: ['1:1', '3:2'], supportsNegativePrompt: false,
        supportsSeed: false, protocol: 'sync', defaultSize: '1024x1024',
      },
    ],
  },
];

const targets = [
  { provider: 'fal' as const, model: 'fal-ai/flux/schnell' },
  { provider: 'zenmux' as const, model: 'openai/gpt-image-2' },
];

describe('web-client capabilities', () => {
  it('derives only the controls shared by selected models', () => {
    expect(deriveGenerationControls(providers, targets)).toEqual({
      aspectRatios: ['1:1'],
      maxCount: 1,
      canSetSeed: true,
      canSetNegativePrompt: false,
    });
  });

  it('builds the public targets request and rejects unsupported shared choices', () => {
    expect(
      buildSubmitGenerationRequest(
        { prompt: 'A cat', targets, aspectRatio: '1:1', seed: 42 },
        providers,
      ),
    ).toMatchObject({ targets, seed: 42 });

    expect(() =>
      buildSubmitGenerationRequest(
        { prompt: 'A cat', targets, aspectRatio: '16:9' },
        providers,
      ),
    ).toThrow('not shared');

    expect(() =>
      buildSubmitGenerationRequest(
        { prompt: 'A cat', targets, aspectRatio: '1:1', count: 2 },
        providers,
      ),
    ).toThrow('Count exceeds');
  });
});
