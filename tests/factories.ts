import type {
  NormalizedRequest,
  ProviderImageRef,
  JobHandle,
  ProviderCapabilities,
} from '../src/lib/providers/types';

export function makeNormalizedRequest(
  overrides: Partial<NormalizedRequest> = {},
): NormalizedRequest {
  return {
    prompt: 'A cat wearing a space helmet',
    mode: 'text-to-image',
    count: 1,
    ...overrides,
  };
}

export function makeProviderImageRef(
  overrides: Partial<ProviderImageRef> = {},
): ProviderImageRef {
  return {
    url: 'https://cdn.example.com/image.png',
    width: 1024,
    height: 1024,
    contentType: 'image/png',
    index: 0,
    ...overrides,
  };
}

export function makeJobHandle(overrides: Partial<JobHandle> = {}): JobHandle {
  return {
    providerId: 'fal',
    model: 'fal-ai/flux/schnell',
    externalId: 'req-1',
    statusUrl: 'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/status',
    responseUrl:
      'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/response',
    cancelUrl:
      'https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/cancel',
    submittedAt: '2026-07-12T10:00:00.000Z',
    ...overrides,
  };
}

export function makeProviderCapabilities(
  overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities {
  return {
    providerId: 'fal',
    model: 'fal-ai/flux/schnell',
    displayName: 'FLUX Schnell',
    modes: ['text-to-image'],
    maxCount: 4,
    supportedSizes: ['square_hd'],
    supportedAspectRatios: [],
    supportsNegativePrompt: false,
    supportsSeed: true,
    protocol: 'async',
    defaultSize: 'square_hd',
    ...overrides,
  };
}
