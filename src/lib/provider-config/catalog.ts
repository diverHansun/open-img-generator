import type { ProviderCapabilities, ProviderId } from '../providers';
import type { ProviderCredentialName } from '../user-config';
import { falCapabilities } from '../providers/capabilities/fal';
import { zenmuxCapabilities } from '../providers/capabilities/zenmux';
import { siliconflowCapabilities } from '../providers/capabilities/siliconflow';
import { zhipuCapabilities } from '../providers/capabilities/zhipu';
import { doubaoCapabilities } from '../providers/capabilities/doubao';
import { qwenCapabilities } from '../providers/capabilities/qwen';
import { providerMetadata } from './provider-metadata';

export type ProviderCatalogEntry = {
  providerId: ProviderId;
  displayName: string;
  credentialName: ProviderCredentialName;
  keyApplyUrl: string;
  models: ProviderCapabilities[];
};

/**
 * Static product metadata only. It intentionally has no remote health,
 * credential, account, or billing state, so it is safe to return to clients.
 */
const capabilitiesByProvider: Record<ProviderId, ProviderCapabilities[]> = {
  fal: falCapabilities,
  zenmux: zenmuxCapabilities,
  siliconflow: siliconflowCapabilities,
  zhipu: zhipuCapabilities,
  doubao: doubaoCapabilities,
  qwen: qwenCapabilities,
};

export const providerCatalog: readonly ProviderCatalogEntry[] =
  providerMetadata.map((metadata) => ({
    ...metadata,
    models: capabilitiesByProvider[metadata.providerId],
  }));

export function isKnownProviderId(value: string): value is ProviderId {
  return providerCatalog.some((entry) => entry.providerId === value);
}

export function getProviderCatalogEntry(
  providerId: string,
): ProviderCatalogEntry | undefined {
  return providerCatalog.find((entry) => entry.providerId === providerId);
}
