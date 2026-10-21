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

const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  fal: '/assets/providers/fal.svg',
  zenmux: '/assets/providers/zenmux.svg',
  siliconflow: '/assets/providers/siliconflow.svg',
  zhipu: '/assets/providers/zhipu.svg',
  doubao: '/assets/providers/doubao.svg',
  qwen: '/assets/providers/qwen.svg',
};

/** Brand logo bundled under public/assets/providers, if one exists. */
export function getProviderLogoSrc(providerId: string): string | undefined {
  return Object.hasOwn(PROVIDER_LOGOS, providerId)
    ? PROVIDER_LOGOS[providerId]
    : undefined;
}
