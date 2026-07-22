import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

type QwenSizeProfile = Readonly<{
  path: readonly string[];
  defaultSize: string;
  aspectRatioSizes: Readonly<Record<string, string>>;
}>;

export type QwenImageProfile =
  | (QwenSizeProfile & Readonly<{ kind: 'legacy-text2image-async' }>)
  | (QwenSizeProfile & Readonly<{ kind: 'multimodal-sync' }>)
  | (QwenSizeProfile & Readonly<{ kind: 'multimodal-async' }>);

const SQUARE_1K_RATIO_SIZES = {
  '1:1': '1024*1024',
  '3:2': '1152*768',
  '2:3': '768*1152',
  '4:3': '1280*960',
  '3:4': '960*1280',
  '16:9': '1280*720',
  '9:16': '720*1280',
} as const;

const specs = [
  {
    capabilities: {
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
    } satisfies ProviderCapabilities,
    profile: {
      kind: 'legacy-text2image-async',
      path: ['services', 'aigc', 'text2image', 'image-synthesis'],
      defaultSize: '1664*928',
      aspectRatioSizes: {
        '16:9': '1664*928',
        '4:3': '1472*1104',
        '1:1': '1328*1328',
        '3:4': '1104*1472',
        '9:16': '928*1664',
      },
    },
    imageOutput: { delivery: 'remote', allowedRemoteHosts: ['.aliyuncs.com'] },
  },
  {
    capabilities: {
      providerId: 'qwen',
      model: 'qwen-image-2.0-pro',
      displayName: 'Qwen Image 2.0 Pro',
      modes: ['text-to-image'],
      maxCount: 6,
      supportedSizes: Object.values(SQUARE_1K_RATIO_SIZES),
      supportedAspectRatios: Object.keys(SQUARE_1K_RATIO_SIZES),
      supportsNegativePrompt: true,
      supportsSeed: true,
      protocol: 'sync',
      defaultSize: '1024*1024',
    } satisfies ProviderCapabilities,
    profile: {
      kind: 'multimodal-sync',
      path: ['services', 'aigc', 'multimodal-generation', 'generation'],
      defaultSize: '1024*1024',
      aspectRatioSizes: SQUARE_1K_RATIO_SIZES,
    },
    imageOutput: { delivery: 'remote', allowedRemoteHosts: ['.aliyuncs.com'] },
  },
  {
    capabilities: {
      providerId: 'qwen',
      model: 'wan2.7-image-pro',
      displayName: 'Wan 2.7 Image Pro',
      modes: ['text-to-image'],
      maxCount: 4,
      supportedSizes: Object.values(SQUARE_1K_RATIO_SIZES),
      supportedAspectRatios: Object.keys(SQUARE_1K_RATIO_SIZES),
      supportsNegativePrompt: false,
      supportsSeed: true,
      protocol: 'async',
      defaultSize: '1024*1024',
    } satisfies ProviderCapabilities,
    profile: {
      kind: 'multimodal-async',
      path: ['services', 'aigc', 'image-generation', 'generation'],
      defaultSize: '1024*1024',
      aspectRatioSizes: SQUARE_1K_RATIO_SIZES,
    },
    imageOutput: { delivery: 'remote', allowedRemoteHosts: ['.aliyuncs.com'] },
  },
] satisfies readonly ProviderModelSpec<QwenImageProfile>[];

export const qwenModelSpecs = defineProviderModelSpecs<QwenImageProfile>(specs);
export const qwenCapabilities = modelCapabilities(qwenModelSpecs);
