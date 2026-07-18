import type { ProviderCapabilities, ProviderId } from '../providers';
import type { ProviderCredentialName } from '../user-config';
import { falCapabilities } from '../providers/capabilities/fal';
import { zenmuxCapabilities } from '../providers/capabilities/zenmux';
import { siliconflowCapabilities } from '../providers/capabilities/siliconflow';
import { zhipuCapabilities } from '../providers/capabilities/zhipu';
import { doubaoCapabilities } from '../providers/capabilities/doubao';
import { qwenCapabilities } from '../providers/capabilities/qwen';
import { klingCapabilities } from '../providers/capabilities/kling';

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
export const providerCatalog: readonly ProviderCatalogEntry[] = [
  {
    providerId: 'fal',
    displayName: 'fal.ai',
    credentialName: 'FAL_KEY',
    keyApplyUrl: 'https://fal.ai/dashboard/keys',
    models: falCapabilities,
  },
  {
    providerId: 'zenmux',
    displayName: 'ZenMux',
    credentialName: 'ZENMUX_API_KEY',
    keyApplyUrl: 'https://zenmux.ai/console/api-keys',
    models: zenmuxCapabilities,
  },
  {
    providerId: 'siliconflow',
    displayName: 'SiliconFlow',
    credentialName: 'SILICONFLOW_API_KEY',
    keyApplyUrl: 'https://cloud.siliconflow.cn/account/ak',
    models: siliconflowCapabilities,
  },
  {
    providerId: 'zhipu',
    displayName: 'Zhipu AI',
    credentialName: 'ZHIPU_API_KEY',
    keyApplyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    models: zhipuCapabilities,
  },
  {
    providerId: 'doubao',
    displayName: 'Doubao Ark',
    credentialName: 'ARK_API_KEY',
    keyApplyUrl: 'https://console.volcengine.com/ark',
    models: doubaoCapabilities,
  },
  {
    providerId: 'qwen',
    displayName: 'Qwen',
    credentialName: 'DASHSCOPE_API_KEY',
    keyApplyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    models: qwenCapabilities,
  },
  {
    providerId: 'kling',
    displayName: 'Kling AI',
    credentialName: 'KLING_API_KEY',
    keyApplyUrl: 'https://app.klingai.com/global/dev/api-key',
    models: klingCapabilities,
  },
];

export function isKnownProviderId(value: string): value is ProviderId {
  return providerCatalog.some((entry) => entry.providerId === value);
}

export function getProviderCatalogEntry(
  providerId: string,
): ProviderCatalogEntry | undefined {
  return providerCatalog.find((entry) => entry.providerId === providerId);
}
