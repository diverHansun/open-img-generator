import type { ProviderCapabilities } from '../types';

export const siliconflowCapabilities: ProviderCapabilities[] = [
  {
    providerId: 'siliconflow',
    model: 'Kwai-Kolors/Kolors',
    displayName: 'Kolors',
    modes: ['text-to-image'],
    // Sync generation remains count=1 in the current job-engine MVP contract.
    maxCount: 1,
    supportedSizes: ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'],
    supportedAspectRatios: ['1:1', '3:4', '1:2', '9:16'],
    supportsNegativePrompt: true,
    supportsSeed: true,
    protocol: 'sync',
    defaultSize: '1024x1024',
  },
];
