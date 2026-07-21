import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type ZhipuImageProfile = Readonly<{
  kind: 'images-generation';
  defaultSize: string;
  aspectRatioSizes: Readonly<Record<string, string>>;
}>;

const specs = [
  {
    capabilities: {
      providerId: 'zhipu',
      model: 'glm-image',
      displayName: 'GLM-Image',
      modes: ['text-to-image'],
      maxCount: 1,
      supportedSizes: [
        '1280x1280',
        '1568x1056',
        '1056x1568',
        '1472x1088',
        '1088x1472',
        '1728x960',
        '960x1728',
      ],
      supportedAspectRatios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
      supportsNegativePrompt: false,
      supportsSeed: false,
      protocol: 'sync',
      defaultSize: '1280x1280',
    } satisfies ProviderCapabilities,
    profile: {
      kind: 'images-generation',
      defaultSize: '1280x1280',
      aspectRatioSizes: {
        '1:1': '1280x1280',
        '3:2': '1568x1056',
        '2:3': '1056x1568',
        '4:3': '1472x1088',
        '3:4': '1088x1472',
        '16:9': '1728x960',
        '9:16': '960x1728',
      },
    },
  },
] satisfies readonly ProviderModelSpec<ZhipuImageProfile>[];

export const zhipuModelSpecs = defineProviderModelSpecs(specs);
export const zhipuCapabilities = modelCapabilities(zhipuModelSpecs);
