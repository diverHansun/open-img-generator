import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type ZenmuxImageProfile =
  | Readonly<{
      kind: 'openai-images';
      defaultSize: string;
      aspectRatioSizes: Readonly<Record<string, string>>;
      allowedProviderOptions: readonly string[];
    }>
  | Readonly<{
      kind: 'gemini-generate-content';
      publisher: 'google';
      apiModel: string;
      defaultAspectRatio: string;
      defaultImageSize: string;
      supportedImageSizes: readonly string[];
    }>;

const OPENAI_IMAGE_PROFILE: ZenmuxImageProfile = {
  kind: 'openai-images',
  defaultSize: '1024x1024',
  aspectRatioSizes: {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
  },
  allowedProviderOptions: ['background', 'moderation', 'output_format', 'quality'],
};

const GEMINI_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;

function geminiSpec(
  model: string,
  displayName: string,
  options: { imageSizes: readonly string[]; defaultImageSize: string },
): ProviderModelSpec<ZenmuxImageProfile> {
  return {
    capabilities: {
      providerId: 'zenmux',
      model,
      displayName,
      modes: ['text-to-image'],
      maxCount: 1,
      supportedSizes: [...options.imageSizes],
      supportedAspectRatios: [...GEMINI_ASPECT_RATIOS],
      supportsNegativePrompt: false,
      supportsSeed: false,
      protocol: 'sync',
      defaultSize: options.defaultImageSize,
    },
    profile: {
      kind: 'gemini-generate-content',
      publisher: 'google',
      apiModel: model.slice('google/'.length),
      defaultAspectRatio: '1:1',
      defaultImageSize: options.defaultImageSize,
      supportedImageSizes: options.imageSizes,
    },
  };
}

const specs = [
  {
    capabilities: {
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
    } satisfies ProviderCapabilities,
    profile: OPENAI_IMAGE_PROFILE,
  },
  {
    capabilities: {
      providerId: 'zenmux',
      model: 'openai/gpt-image-1.5',
      displayName: 'GPT Image 1.5',
      modes: ['text-to-image'],
      maxCount: 4,
      supportedSizes: ['1024x1024', '1536x1024', '1024x1536'],
      supportedAspectRatios: ['1:1', '3:2', '2:3'],
      supportsNegativePrompt: false,
      supportsSeed: false,
      protocol: 'sync',
      defaultSize: '1024x1024',
    } satisfies ProviderCapabilities,
    profile: OPENAI_IMAGE_PROFILE,
  },
  geminiSpec('google/gemini-2.5-flash-image', 'Nano Banana', {
    imageSizes: ['1K'],
    defaultImageSize: '1K',
  }),
  geminiSpec('google/gemini-3.1-flash-image', 'Nano Banana 2', {
    imageSizes: ['1K', '2K', '4K'],
    defaultImageSize: '1K',
  }),
  geminiSpec('google/gemini-3-pro-image', 'Nano Banana Pro', {
    imageSizes: ['1K', '2K', '4K'],
    defaultImageSize: '1K',
  }),
  geminiSpec('google/gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite', {
    imageSizes: ['512px', '1K', '2K', '4K'],
    defaultImageSize: '1K',
  }),
] satisfies readonly ProviderModelSpec<ZenmuxImageProfile>[];

export const zenmuxModelSpecs = defineProviderModelSpecs(specs);
export const zenmuxCapabilities = modelCapabilities(zenmuxModelSpecs);
