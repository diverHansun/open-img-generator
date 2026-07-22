import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type SiliconFlowImageProfile = Readonly<{
  kind: 'images-generation';
  defaultSize: string;
  aspectRatioSizes: Readonly<Record<string, string>>;
  supportsBatchSize: boolean;
}>;

const ASPECT_RATIO_SIZES = {
  '1:1': '1024x1024',
  '3:4': '960x1280',
  '1:2': '720x1440',
  '9:16': '720x1280',
} as const;

function imageSpec(
  model: string,
  displayName: string,
  options: { supportsBatchSize: boolean; supportsNegativePrompt: boolean },
): ProviderModelSpec<SiliconFlowImageProfile> {
  return {
    capabilities: {
      providerId: 'siliconflow',
      model,
      displayName,
      modes: ['text-to-image'],
      // Sync generation remains count=1 in the current job-engine MVP contract.
      maxCount: 1,
      supportedSizes: ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'],
      supportedAspectRatios: ['1:1', '3:4', '1:2', '9:16'],
      supportsNegativePrompt: options.supportsNegativePrompt,
      supportsSeed: true,
      protocol: 'sync',
      defaultSize: '1024x1024',
    },
    profile: {
      kind: 'images-generation',
      defaultSize: '1024x1024',
      aspectRatioSizes: ASPECT_RATIO_SIZES,
      supportsBatchSize: options.supportsBatchSize,
    },
    imageOutput: {
      delivery: 'remote',
      allowedRemoteHosts: ['.siliconflow.cn', '.aliyuncs.com'],
    },
  };
}

const specs = [
  imageSpec('Kwai-Kolors/Kolors', 'Kolors', {
    supportsBatchSize: true,
    supportsNegativePrompt: true,
  }),
  imageSpec('Tongyi-MAI/Z-Image-Turbo', 'Z-Image Turbo', {
    supportsBatchSize: false,
    supportsNegativePrompt: false,
  }),
] satisfies readonly ProviderModelSpec<SiliconFlowImageProfile>[];

export const siliconflowModelSpecs = defineProviderModelSpecs(specs);
export const siliconflowCapabilities = modelCapabilities(siliconflowModelSpecs);
