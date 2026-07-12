import type { ProviderCapabilities } from '../types';

export const falCapabilities: ProviderCapabilities[] = [
  {
    providerId: 'fal',
    model: 'fal-ai/flux/schnell',
    displayName: 'FLUX Schnell',
    modes: ['text-to-image'],
    maxCount: 4,
    supportedSizes: [
      'square_hd',
      'square',
      'portrait_4_3',
      'portrait_16_9',
      'landscape_4_3',
      'landscape_16_9',
    ],
    supportedAspectRatios: [],
    supportsNegativePrompt: false,
    supportsSeed: true,
    protocol: 'async',
    defaultSize: 'square_hd',
  },
];
