import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type ZenmuxImageProfile = Readonly<{
  kind: 'openai-images';
  defaultSize: string;
  aspectRatioSizes: Readonly<Record<string, string>>;
  allowedProviderOptions: readonly string[];
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
] satisfies readonly ProviderModelSpec<ZenmuxImageProfile>[];

export const zenmuxModelSpecs = defineProviderModelSpecs(specs);
export const zenmuxCapabilities = modelCapabilities(zenmuxModelSpecs);
