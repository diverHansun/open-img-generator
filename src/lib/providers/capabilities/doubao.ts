import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type DoubaoImageProfile = Readonly<{
  kind: 'seedream-images';
  defaultSize: string;
  aspectRatioSizes: Readonly<Record<string, string>>;
  responseFormat: 'b64_json';
}>;

const SEEDREAM_PROFILE: DoubaoImageProfile = {
  kind: 'seedream-images',
  defaultSize: '2K',
  aspectRatioSizes: {
    '1:1': '2048x2048',
    '3:2': '2048x1365',
    '2:3': '1365x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
  },
  responseFormat: 'b64_json',
};

function seedreamSpec(
  model: string,
  displayName: string,
): ProviderModelSpec<DoubaoImageProfile> {
  return {
    capabilities: {
      providerId: 'doubao',
      model,
      displayName,
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
    profile: SEEDREAM_PROFILE,
  };
}

const specs = [
  seedreamSpec('doubao-seedream-4-0-250828', 'Seedream 4.0'),
  seedreamSpec('doubao-seedream-4-5-251128', 'Seedream 4.5'),
  seedreamSpec('doubao-seedream-5-0-260128', 'Seedream 5.0 Lite'),
] satisfies readonly ProviderModelSpec<DoubaoImageProfile>[];

export const doubaoModelSpecs = defineProviderModelSpecs(specs);
export const doubaoCapabilities = modelCapabilities(doubaoModelSpecs);
