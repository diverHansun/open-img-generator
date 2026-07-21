import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type FalImageProfile = Readonly<{
  kind: 'flux-image-size';
  defaultSize: string;
  aspectRatioSizes: Readonly<Record<string, string>>;
}>;

const specs = [
  {
    capabilities: {
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
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      supportsNegativePrompt: false,
      supportsSeed: true,
      protocol: 'async',
      defaultSize: 'square_hd',
    } satisfies ProviderCapabilities,
    profile: {
      kind: 'flux-image-size',
      defaultSize: 'square_hd',
      aspectRatioSizes: {
        '1:1': 'square_hd',
        '4:3': 'landscape_4_3',
        '3:4': 'portrait_4_3',
        '16:9': 'landscape_16_9',
        '9:16': 'portrait_16_9',
      },
    },
  },
] satisfies readonly ProviderModelSpec<FalImageProfile>[];

export const falModelSpecs = defineProviderModelSpecs(specs);
export const falCapabilities = modelCapabilities(falModelSpecs);
