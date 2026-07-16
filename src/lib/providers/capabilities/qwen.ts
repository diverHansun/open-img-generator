import type { ProviderCapabilities } from '../types';

export const qwenCapabilities: ProviderCapabilities[] = [
  {
    providerId: 'qwen',
    model: 'qwen-image-plus',
    displayName: 'Qwen-Image Plus',
    modes: ['text-to-image'],
    maxCount: 1,
    supportedSizes: ['1664*928', '1472*1104', '1328*1328', '1104*1472', '928*1664'],
    supportedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'],
    supportsNegativePrompt: true,
    supportsSeed: true,
    protocol: 'async',
    defaultSize: '1664*928',
  },
];
