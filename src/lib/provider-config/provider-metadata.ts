import type { ProviderId } from '../providers';
import type { ProviderCredentialName } from '../user-config';

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
export const providerMetadata: readonly ProviderMetadata[] = [
  {
    providerId: 'fal',
    displayName: 'fal.ai',
    credentialName: 'FAL_KEY',
    keyApplyUrl: 'https://fal.ai/dashboard/keys',
  },
  {
    providerId: 'zenmux',
    displayName: 'ZenMux',
    credentialName: 'ZENMUX_API_KEY',
    keyApplyUrl: 'https://zenmux.ai/console/api-keys',
  },
  {
    providerId: 'siliconflow',
    displayName: 'SiliconFlow',
    credentialName: 'SILICONFLOW_API_KEY',
    keyApplyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    providerId: 'zhipu',
    displayName: 'Zhipu AI',
    credentialName: 'ZHIPU_API_KEY',
    keyApplyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
  {
    providerId: 'doubao',
    displayName: 'Doubao Ark',
    credentialName: 'ARK_API_KEY',
    keyApplyUrl: 'https://console.volcengine.com/ark',
  },
  {
    providerId: 'qwen',
    displayName: 'Qwen',
    credentialName: 'DASHSCOPE_API_KEY',
    keyApplyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
  },
] as const;
