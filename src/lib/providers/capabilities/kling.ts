import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type KlingImageProfile = Readonly<{
  kind: 'image-generation-v1';
  defaultResolution: '1k';
}>;

const specs = [
  {
    capabilities: {
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
    } satisfies ProviderCapabilities,
    profile: {
      kind: 'image-generation-v1',
      defaultResolution: '1k',
    },
    imageOutput: {
      delivery: 'remote',
      allowedRemoteHosts: ['.klingai.com', '.klingai.com.cn'],
    },
  },
] satisfies readonly ProviderModelSpec<KlingImageProfile>[];

export const klingModelSpecs = defineProviderModelSpecs(specs);
export const klingCapabilities = modelCapabilities(klingModelSpecs);
