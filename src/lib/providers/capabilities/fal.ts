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
      allowedProviderOptions: readonly string[];
      supportsCount: boolean;
      supportsNegativePrompt: boolean;
    }>
  | Readonly<{
      kind: 'gpt-image-size';
      defaultSize: string;
      aspectRatioSizes: Readonly<Record<string, string>>;
      supportedSizes: readonly string[];
      supportedAspectRatios: readonly string[];
      maxCount: number;
      qualityValues: readonly string[];
      defaultQuality: string;
      backgroundValues?: readonly string[];
      defaultBackground?: string;
    }>
  | Readonly<{
      kind: 'banana-aspect-ratio';
      defaultAspectRatio: string;
      defaultResolution?: string;
      supportedResolutions: readonly string[];
      safetyToleranceValues: readonly string[];
    }>;

const FAL_IMAGE_SIZES = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
] as const;

const FAL_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
const FAL_ASPECT_RATIO_SIZES = {
  '1:1': 'square_hd',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
} as const;

const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
const GPT_IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3'] as const;
const GPT_IMAGE_ASPECT_RATIO_SIZES = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
} as const;
const GPT_IMAGE_2_SIZES = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
  'auto',
] as const;
const GPT_IMAGE_2_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
const GPT_IMAGE_2_ASPECT_RATIO_SIZES = {
  '1:1': 'square_hd',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
} as const;

function fluxSpec(
  model: string,
  displayName: string,
  options: {
    maxCount: number;
    supportsNegativePrompt?: boolean;
    allowedProviderOptions?: readonly string[];
  },
): ProviderModelSpec<FalImageProfile> {
  return {
    capabilities: {
      providerId: 'fal',
      model,
      displayName,
      modes: ['text-to-image'],
      maxCount: options.maxCount,
      supportedSizes: [...FAL_IMAGE_SIZES],
      supportedAspectRatios: [...FAL_ASPECT_RATIOS],
      supportsNegativePrompt: options.supportsNegativePrompt ?? false,
      supportsSeed: true,
      protocol: 'async',
      defaultSize: 'square_hd',
    },
    profile: {
      kind: 'flux-image-size',
      defaultSize: 'square_hd',
      aspectRatioSizes: FAL_ASPECT_RATIO_SIZES,
      allowedProviderOptions: options.allowedProviderOptions ?? [],
      supportsCount: options.maxCount > 1,
      supportsNegativePrompt: options.supportsNegativePrompt ?? false,
    },
    imageOutput: {
      delivery: 'remote',
      allowedRemoteHosts: ['.fal.media', '.fal.ai'],
    },
  };
}

function bananaSpec(
  model: string,
  displayName: string,
  options: {
    defaultAspectRatio: string;
    supportedAspectRatios: string[];
    supportedResolutions: string[];
    defaultResolution?: string;
    maxCount?: number;
    safetyToleranceValues?: string[];
  },
): ProviderModelSpec<FalImageProfile> {
  return {
    capabilities: {
      providerId: 'fal',
      model,
      displayName,
      modes: ['text-to-image'],
      maxCount: options.maxCount ?? 4,
      supportedSizes: options.supportedResolutions,
      supportedAspectRatios: options.supportedAspectRatios,
      supportsNegativePrompt: false,
      supportsSeed: true,
      protocol: 'async',
      defaultSize: options.defaultResolution ?? options.supportedResolutions[0] ?? '1K',
    },
    profile: {
      kind: 'banana-aspect-ratio',
      defaultAspectRatio: options.defaultAspectRatio,
      ...(options.supportedResolutions.length > 0
        ? { defaultResolution: options.defaultResolution ?? options.supportedResolutions[0] }
        : {}),
      supportedResolutions: options.supportedResolutions,
      safetyToleranceValues: options.safetyToleranceValues ?? ['1', '2', '3', '4', '5', '6'],
    },
    imageOutput: {
      delivery: 'remote',
      allowedRemoteHosts: ['.fal.media', '.fal.ai'],
    },
  };
}

function gptImageSpec(
  model: string,
  displayName: string,
  options: {
    defaultSize: string;
    supportedSizes: readonly string[];
    supportedAspectRatios: readonly string[];
    aspectRatioSizes: Readonly<Record<string, string>>;
    maxCount: number;
    qualityValues: readonly string[];
    defaultQuality: string;
    backgroundValues?: readonly string[];
    defaultBackground?: string;
  },
): ProviderModelSpec<FalImageProfile> {
  return {
    capabilities: {
      providerId: 'fal',
      model,
      displayName,
      modes: ['text-to-image'],
      maxCount: options.maxCount,
      supportedSizes: [...options.supportedSizes],
      supportedAspectRatios: [...options.supportedAspectRatios],
      supportsNegativePrompt: false,
      supportsSeed: false,
      protocol: 'async',
      defaultSize: options.defaultSize,
    },
    profile: {
      kind: 'gpt-image-size',
      defaultSize: options.defaultSize,
      aspectRatioSizes: options.aspectRatioSizes,
      supportedSizes: options.supportedSizes,
      supportedAspectRatios: options.supportedAspectRatios,
      maxCount: options.maxCount,
      qualityValues: options.qualityValues,
      defaultQuality: options.defaultQuality,
      ...(options.backgroundValues ? { backgroundValues: options.backgroundValues } : {}),
      ...(options.defaultBackground ? { defaultBackground: options.defaultBackground } : {}),
    },
    imageOutput: {
      delivery: 'remote',
      allowedRemoteHosts: ['.fal.media', '.fal.ai'],
    },
  };
}

const specs = [
  fluxSpec('fal-ai/flux/schnell', 'FLUX Schnell', { maxCount: 4 }),
  gptImageSpec('fal-ai/gpt-image-1/text-to-image', 'GPT Image 1', {
    defaultSize: 'auto',
    supportedSizes: GPT_IMAGE_SIZES,
    supportedAspectRatios: GPT_IMAGE_ASPECT_RATIOS,
    aspectRatioSizes: GPT_IMAGE_ASPECT_RATIO_SIZES,
    maxCount: 1,
    qualityValues: ['auto', 'low', 'medium', 'high'],
    defaultQuality: 'auto',
    backgroundValues: ['auto', 'transparent', 'opaque'],
    defaultBackground: 'auto',
  }),
  gptImageSpec('fal-ai/gpt-image-1.5', 'GPT Image 1.5', {
    defaultSize: '1024x1024',
    supportedSizes: GPT_IMAGE_SIZES.filter((size) => size !== 'auto'),
    supportedAspectRatios: GPT_IMAGE_ASPECT_RATIOS,
    aspectRatioSizes: GPT_IMAGE_ASPECT_RATIO_SIZES,
    maxCount: 4,
    qualityValues: ['low', 'medium', 'high'],
    defaultQuality: 'high',
    backgroundValues: ['auto', 'transparent', 'opaque'],
    defaultBackground: 'auto',
  }),
  gptImageSpec('openai/gpt-image-2', 'GPT Image 2', {
    defaultSize: 'landscape_4_3',
    supportedSizes: GPT_IMAGE_2_SIZES,
    supportedAspectRatios: GPT_IMAGE_2_ASPECT_RATIOS,
    aspectRatioSizes: GPT_IMAGE_2_ASPECT_RATIO_SIZES,
    maxCount: 1,
    qualityValues: ['auto', 'low', 'medium', 'high'],
    defaultQuality: 'high',
  }),
  bananaSpec('fal-ai/nano-banana', 'Nano Banana', {
    defaultAspectRatio: '1:1',
    supportedAspectRatios: [
      '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16',
    ],
    supportedResolutions: [],
  }),
  bananaSpec('google/nano-banana-lite', 'Nano Banana Lite', {
    defaultAspectRatio: 'auto',
    supportedAspectRatios: [
      '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3',
      '9:16', '4:1', '1:4', '8:1', '1:8',
    ],
    supportedResolutions: [],
  }),
  bananaSpec('fal-ai/nano-banana-2', 'Nano Banana 2', {
    defaultAspectRatio: 'auto',
    supportedAspectRatios: [
      '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3',
      '9:16', '4:1', '1:4', '8:1', '1:8',
    ],
    supportedResolutions: ['0.5K', '1K', '2K', '4K'],
    defaultResolution: '1K',
  }),
  bananaSpec('fal-ai/nano-banana-pro', 'Nano Banana Pro', {
    defaultAspectRatio: '1:1',
    supportedAspectRatios: [
      '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16',
    ],
    supportedResolutions: ['1K', '2K', '4K'],
    defaultResolution: '1K',
  }),
  fluxSpec('fal-ai/flux-2', 'FLUX 2 Dev', {
    maxCount: 4,
    allowedProviderOptions: [
      'guidance_scale',
      'num_inference_steps',
      'acceleration',
      'enable_prompt_expansion',
      'enable_safety_checker',
      'output_format',
    ],
  }),
  fluxSpec('fal-ai/flux-2-pro', 'FLUX 2 Pro', {
    maxCount: 1,
    allowedProviderOptions: [
      'safety_tolerance',
      'enable_safety_checker',
      'output_format',
    ],
  }),
  fluxSpec('fal-ai/flux-2-flex', 'FLUX 2 Flex', {
    maxCount: 1,
    allowedProviderOptions: [
      'safety_tolerance',
      'enable_safety_checker',
      'output_format',
      'guidance_scale',
      'num_inference_steps',
    ],
  }),
  // The public 4B endpoint is the distilled four-step model. Fal's full-CFG
  // variant is explicitly named `/base`; there is no `/distilled` endpoint.
  fluxSpec('fal-ai/flux-2/klein/4b', 'FLUX 2 Klein 4B', {
    maxCount: 4,
    allowedProviderOptions: [
      'num_inference_steps',
      'enable_safety_checker',
      'output_format',
    ],
  }),
  fluxSpec('fal-ai/flux-2/klein/4b/base', 'FLUX 2 Klein 4B Base', {
    maxCount: 4,
    supportsNegativePrompt: true,
    allowedProviderOptions: [
      'guidance_scale',
      'num_inference_steps',
      'acceleration',
      'enable_safety_checker',
      'output_format',
    ],
  }),
] satisfies readonly ProviderModelSpec<FalImageProfile>[];

export const falModelSpecs = defineProviderModelSpecs(specs);
export const falCapabilities = modelCapabilities(falModelSpecs);
