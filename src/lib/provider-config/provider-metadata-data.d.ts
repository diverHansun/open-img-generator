import type { ProviderId } from '../providers';
import type { ProviderCredentialName } from '../user-config';

export type ProviderMetadataData = {
  providerId: ProviderId;
  displayName: string;
  credentialName: ProviderCredentialName;
  keyApplyUrl: string;
};

export const providerMetadataData: readonly ProviderMetadataData[];
