import type {
  ModelPreference,
  ProviderCapabilities,
  ProviderConfiguration,
  ProviderId,
} from '@/lib/web-client';

export type ModelViewRow = {
  key: string;
  providerId: ProviderId;
  providerName: string;
  capability: ProviderCapabilities;
  enabled: boolean;
};

export type ModelViewGroup = {
  providerId: ProviderId;
  providerName: string;
  rows: ModelViewRow[];
};

export function modelViewKey(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

export function buildModelGroups(
  configurations: ProviderConfiguration[],
  preferences: ModelPreference[],
): ModelViewGroup[] {
  const preferenceMap = new Map(
    preferences.map((preference) => [
      modelViewKey(preference.provider, preference.model),
      preference.enabled,
    ]),
  );

  return configurations
    .filter((configuration) => configuration.configured)
    .map((configuration) => ({
      providerId: configuration.providerId,
      providerName: configuration.displayName,
      rows: configuration.models.map((capability) => ({
        key: modelViewKey(configuration.providerId, capability.model),
        providerId: configuration.providerId,
        providerName: configuration.displayName,
        capability,
        enabled:
          preferenceMap.get(modelViewKey(configuration.providerId, capability.model)) ?? true,
      })),
    }));
}

export function filterModelGroups(
  groups: ModelViewGroup[],
  query: string,
  providerId: ProviderId | 'all',
): ModelViewGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  return groups
    .filter((group) => providerId === 'all' || group.providerId === providerId)
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => {
        if (!normalized) return true;
        return [row.providerName, row.capability.displayName, row.capability.model].some((value) =>
          value.toLocaleLowerCase().includes(normalized),
        );
      }),
    }))
    .filter((group) => group.rows.length > 0);
}
