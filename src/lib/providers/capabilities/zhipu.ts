import type { ProviderCapabilities } from '../types';

export const zhipuCapabilities: ProviderCapabilities[] = [
  {
    providerId: 'zhipu',
    model: 'glm-image',
    displayName: 'GLM-Image',
    modes: ['text-to-image'],
    maxCount: 1,
    supportedSizes: [
      '1280x1280',
      '1568x1056',
      '1056x1568',
      '1472x1088',
      '1088x1472',
      '1728x960',
      '960x1728',
    ],
    supportedAspectRatios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
    supportsNegativePrompt: false,
    supportsSeed: false,
    protocol: 'sync',
    defaultSize: '1280x1280',
  },
];
