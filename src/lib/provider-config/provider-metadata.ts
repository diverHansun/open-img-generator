import type { ProviderId } from '../providers';
import type { ProviderCredentialName } from '../user-config';
import { providerMetadataData } from './provider-metadata-data.js';

export type ProviderMetadata = {
  providerId: ProviderId;
  displayName: string;
  credentialName: ProviderCredentialName;
  keyApplyUrl: string;
};

/**
 * Product-owned provider metadata shared by the web catalog and desktop
 * external-navigation policy. It contains no credentials or remote state.
 */
export const providerMetadata: readonly ProviderMetadata[] = providerMetadataData;
