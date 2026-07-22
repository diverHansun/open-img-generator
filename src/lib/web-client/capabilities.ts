import type {
  GenerationTarget,
  ProviderCapabilities,
  ProviderInfo,
  SubmitGenerationPayload,
} from './types';

export type GenerationControls = {
  aspectRatios: string[];
  maxCount: number;
  canSetSeed: boolean;
  canSetNegativePrompt: boolean;
};

export function capabilitiesForTargets(
  providers: ProviderInfo[],
  targets: GenerationTarget[],
): ProviderCapabilities[] {
  const lookup = new Map<string, ProviderCapabilities>();
  for (const provider of providers) {
    for (const model of provider.models) {
      lookup.set(`${provider.id}:${model.model}`, model);
    }
  }

  return targets.map((target) => {
    const capability = lookup.get(`${target.provider}:${target.model}`);
    if (!capability) {
      throw new Error(`Selected target is no longer enabled: ${target.provider}:${target.model}`);
    }
    return capability;
  });
}

function intersection(values: string[][]): string[] {
  if (values.length === 0) return [];
  return values[0]!.filter((value) => values.every((other) => other.includes(value)));
}

export function deriveGenerationControls(
  providers: ProviderInfo[],
  targets: GenerationTarget[],
): GenerationControls {
  const capabilities = capabilitiesForTargets(providers, targets);
  if (capabilities.length === 0) {
    return {
      aspectRatios: [],
      maxCount: 0,
      canSetSeed: false,
      canSetNegativePrompt: false,
    };
  }

  return {
    aspectRatios: intersection(capabilities.map((item) => item.supportedAspectRatios)),
    // The API validates each target against its declared maxCount. Use the
    // same shared ceiling here so the UI neither hides valid sync batches nor
    // offers a count that one selected model will reject.
    maxCount: Math.min(...capabilities.map((item) => item.maxCount)),
    canSetSeed: capabilities.every((item) => item.supportsSeed),
    canSetNegativePrompt: capabilities.every((item) => item.supportsNegativePrompt),
  };
}

export function buildSubmitGenerationRequest(
  request: SubmitGenerationPayload,
  providers: ProviderInfo[],
): SubmitGenerationPayload {
  if (request.targets.length === 0) {
    throw new Error('At least one target must be selected');
  }
  const controls = deriveGenerationControls(providers, request.targets);
  if (request.aspectRatio && !controls.aspectRatios.includes(request.aspectRatio)) {
    throw new Error(`Aspect ratio is not shared by all selected targets: ${request.aspectRatio}`);
  }
  if (request.count != null && request.count > controls.maxCount) {
    throw new Error(`Count exceeds selected target limit: ${controls.maxCount}`);
  }
  if (request.count != null && (!Number.isInteger(request.count) || request.count < 1)) {
    throw new Error('Count must be a positive integer');
  }
  if (request.negativePrompt && !controls.canSetNegativePrompt) {
    throw new Error('Negative prompt is not supported by every selected target');
  }
  if (request.seed != null && !controls.canSetSeed) {
    throw new Error('Seed is not supported by every selected target');
  }
  return { ...request, targets: [...request.targets] };
}
