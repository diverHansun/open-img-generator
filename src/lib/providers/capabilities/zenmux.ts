import type { ProviderCapabilities } from '../types';

export const zenmuxCapabilities: ProviderCapabilities[] = [
  {
    providerId: 'zenmux',
    model: 'openai/gpt-image-2',
    displayName: 'GPT Image 2',
    modes: ['text-to-image'],
    maxCount: 4,
    supportedSizes: ['1024x1024', '1536x1024', '1024x1536'],
    supportedAspectRatios: ['1:1', '3:2', '2:3'],
    supportsNegativePrompt: false,
    supportsSeed: false,
    protocol: 'sync',
    defaultSize: '1024x1024',
  },
];
