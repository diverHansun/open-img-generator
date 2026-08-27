import type { ProviderConfiguration } from '@/lib/web-client';

export type ProviderModelCount =
  | { configured: true; enabled: number; total: number }
  | { configured: false; total: number };

export function getProviderModelCount(
  configuration: ProviderConfiguration,
): ProviderModelCount {
  if (!configuration.configured) {
    return {
      configured: false,
      total: configuration.availableModelCount,
    };
  }
  return {
    configured: true,
    enabled: configuration.enabledModelCount,
    total: configuration.availableModelCount,
  };
}

export function findProviderConfiguration(
  configurations: ProviderConfiguration[],
  providerId: string,
): ProviderConfiguration | undefined {
  return configurations.find(
    (configuration) => configuration.providerId === providerId,
  );
}

export function getProviderMarkText(displayName: string): string {
  const words = displayName.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}
