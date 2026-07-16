import type { ProviderCapabilities } from '../types';

export const klingCapabilities: ProviderCapabilities[] = [
  {
    providerId: 'kling',
    model: 'kling-v3',
    displayName: 'Kling Image V3',
    modes: ['text-to-image', 'image-to-image'],
    maxCount: 9,
    supportedSizes: ['1k', '2k'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'],
    supportsNegativePrompt: true,
    supportsSeed: false,
    protocol: 'async',
    defaultSize: '1k',
  },
];
