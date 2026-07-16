import type { ProviderCapabilities } from '../types';

export const doubaoCapabilities: ProviderCapabilities[] = [
  {
    providerId: 'doubao',
    model: 'doubao-seedream-4-0-250828',
    displayName: 'Seedream 4.0',
    modes: ['text-to-image', 'image-to-image'],
    // The current job-engine keeps sync generation at count=1.
    maxCount: 1,
    supportedSizes: ['2K', '4K'],
    supportedAspectRatios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
    supportsNegativePrompt: false,
    supportsSeed: true,
    protocol: 'sync',
    defaultSize: '2K',
  },
];
