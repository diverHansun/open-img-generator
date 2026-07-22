import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type DoubaoImageProfile =
  | Readonly<{
      kind: 'seedream-images';
      defaultSize: string;
      aspectRatioSizes: Readonly<Record<string, string>>;
      responseFormat: 'b64_json';
    }>
  | Readonly<{
      kind: 'seedance-video';
      defaultAspectRatio: string;
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
    imageOutput: { delivery: 'inline', allowedRemoteHosts: [] },
  };
}

function seedanceSpec(
  model: string,
  displayName: string,
): ProviderModelSpec<DoubaoImageProfile> {
  return {
    capabilities: {
      providerId: 'doubao',
      model,
      displayName,
      modes: ['text-to-video'],
      maxCount: 1,
      supportedSizes: ['720p', '1080p'],
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      supportsNegativePrompt: false,
      supportsSeed: false,
      protocol: 'async',
      defaultSize: '720p',
      mediaKind: 'video',
    },
    profile: { kind: 'seedance-video', defaultAspectRatio: '16:9' },
  };
}

const specs = [
  seedreamSpec('doubao-seedream-4-0-250828', 'Seedream 4.0'),
  seedreamSpec('doubao-seedream-4-5-251128', 'Seedream 4.5'),
  seedreamSpec('doubao-seedream-5-0-260128', 'Seedream 5.0 Lite'),
  seedanceSpec('doubao-seedance-1-5-pro-251215', 'Seedance 1.5 Pro'),
  seedanceSpec('doubao-seedance-2-0-260128', 'Seedance 2.0'),
  seedanceSpec('doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast'),
] satisfies readonly ProviderModelSpec<DoubaoImageProfile>[];

export const doubaoModelSpecs = defineProviderModelSpecs(specs);
export const doubaoCapabilities = modelCapabilities(doubaoModelSpecs);
