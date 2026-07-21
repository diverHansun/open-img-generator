import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type FalImageProfile =
  | Readonly<{
      kind: 'flux-image-size';
      defaultSize: string;
      aspectRatioSizes: Readonly<Record<string, string>>;
    }>
  | Readonly<{
      kind: 'banana-aspect-ratio';
      defaultAspectRatio: string;
      defaultResolution: string;
      supportedResolutions: readonly string[];
    }>;

function bananaSpec(
  model: string,
  displayName: string,
  options: {
    defaultAspectRatio: string;
    supportedAspectRatios: string[];
    supportedResolutions: string[];
  },
): ProviderModelSpec<FalImageProfile> {
  return {
    capabilities: {
      providerId: 'fal',
      model,
      displayName,
      modes: ['text-to-image'],
      maxCount: 4,
      supportedSizes: options.supportedResolutions,
      supportedAspectRatios: options.supportedAspectRatios,
      supportsNegativePrompt: false,
      supportsSeed: true,
      protocol: 'async',
      defaultSize: '1K',
    },
    profile: {
      kind: 'banana-aspect-ratio',
      defaultAspectRatio: options.defaultAspectRatio,
      defaultResolution: '1K',
      supportedResolutions: options.supportedResolutions,
    },
  };
}

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
  bananaSpec('fal-ai/nano-banana-2', 'Nano Banana 2', {
    defaultAspectRatio: 'auto',
    supportedAspectRatios: [
      '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3',
      '9:16', '4:1', '1:4', '8:1', '1:8',
    ],
    supportedResolutions: ['0.5K', '1K', '2K', '4K'],
  }),
  bananaSpec('fal-ai/nano-banana-pro', 'Nano Banana Pro', {
    defaultAspectRatio: '1:1',
    supportedAspectRatios: [
      '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16',
    ],
    supportedResolutions: ['1K', '2K', '4K'],
  }),
] satisfies readonly ProviderModelSpec<FalImageProfile>[];

export const falModelSpecs = defineProviderModelSpecs(specs);
export const falCapabilities = modelCapabilities(falModelSpecs);
