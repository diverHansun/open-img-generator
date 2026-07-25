/**
 * Runtime-safe provider metadata. Keep this file free of TypeScript-only
 * imports so Node smoke scripts can enforce the same credential boundary as
 * the application and Electron launcher.
 */
export const providerMetadataData = [
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
];
