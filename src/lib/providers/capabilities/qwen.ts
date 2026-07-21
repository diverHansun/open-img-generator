import type { ProviderCapabilities } from '../types';
import {
  defineProviderModelSpecs,
  modelCapabilities,
  type ProviderModelSpec,
} from '../model-spec';

export type QwenImageProfile = Readonly<{
  kind: 'legacy-text2image-async';
  path: readonly string[];
  defaultSize: string;
  aspectRatioSizes: Readonly<Record<string, string>>;
}>;

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
  },
] satisfies readonly ProviderModelSpec<QwenImageProfile>[];

export const qwenModelSpecs = defineProviderModelSpecs(specs);
export const qwenCapabilities = modelCapabilities(qwenModelSpecs);
