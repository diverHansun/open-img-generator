import type {
  ProviderCapabilities,
  ProviderId,
  SubmitResult,
} from './types';

/**
 * Internal provider metadata. Profiles deliberately remain provider-specific;
 * only `capabilities` is projected into the public catalog.
 */
export type ProviderModelSpec<Profile> = Readonly<{
  capabilities: ProviderCapabilities;
  profile: Profile;
}>;

export function defineProviderModelSpecs<Profile>(
  specs: readonly ProviderModelSpec<Profile>[],
): ReadonlyMap<string, ProviderModelSpec<Profile>> {
  const entries = specs.map((spec) => [spec.capabilities.model, spec] as const);
  const modelSpecs = new Map(entries);
  if (modelSpecs.size !== specs.length) {
    throw new Error('Provider model specifications contain duplicate model IDs');
  }
  return modelSpecs;
}

export function modelCapabilities<Profile>(
  specs: ReadonlyMap<string, ProviderModelSpec<Profile>>,
): ProviderCapabilities[] {
  return Array.from(specs.values(), (spec) => spec.capabilities);
}

export function modelCapabilityMap<Profile>(
  specs: ReadonlyMap<string, ProviderModelSpec<Profile>>,
): Map<string, ProviderCapabilities> {
  return new Map(
    Array.from(specs, ([model, spec]) => [model, spec.capabilities] as const),
  );
}

export function unsupportedModelSubmitResult(providerId: ProviderId): SubmitResult {
  return {
    kind: 'failed',
    error: {
      code: 'INVALID_REQUEST',
      message: `Unsupported model for provider ${providerId}`,
      retryable: false,
      httpStatus: 400,
      disposition: 'not_started',
      diagnostic: {
        providerId,
        category: 'model_or_endpoint',
        providerCode: 'unsupported_model',
      },
    },
  };
}
