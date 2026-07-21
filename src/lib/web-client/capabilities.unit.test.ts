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
      canSetSeed: false,
      canSetNegativePrompt: false,
    });
  });

  it('builds the public targets request and rejects unsupported shared choices', () => {
    expect(
      buildSubmitGenerationRequest(
        { prompt: 'A cat', targets, sessionId: 'session-1', aspectRatio: '1:1' },
        providers,
      ),
    ).toMatchObject({ targets });

    expect(() =>
      buildSubmitGenerationRequest(
        { prompt: 'A cat', targets, sessionId: 'session-1', aspectRatio: '1:1', seed: 42 },
        providers,
      ),
    ).toThrow('Seed is not supported by every selected target');

    expect(() =>
      buildSubmitGenerationRequest(
        { prompt: 'A cat', targets, sessionId: 'session-1', aspectRatio: '16:9' },
        providers,
      ),
    ).toThrow('not shared');

    expect(() =>
      buildSubmitGenerationRequest(
        { prompt: 'A cat', targets, sessionId: 'session-1', aspectRatio: '1:1', count: 2 },
        providers,
      ),
    ).toThrow('Count exceeds');
  });

  it('does not impose a client-side target count ceiling', () => {
    const repeatedProviders = Array.from({ length: 9 }, (_, index) => ({
      ...providers[0]!,
      models: [{
        ...providers[0]!.models[0]!,
        model: `fal-ai/flux/model-${index}`,
      }],
    }));
    const manyTargets = repeatedProviders.map((provider) => ({
      provider: provider.id,
      model: provider.models[0]!.model,
    }));

    expect(buildSubmitGenerationRequest({
      prompt: 'A cat',
      targets: manyTargets,
      sessionId: 'session-1',
    }, repeatedProviders).targets).toHaveLength(9);
  });
});
