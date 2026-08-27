export type ProviderCredentialName =
  | 'FAL_KEY'
  | 'ZENMUX_API_KEY'
  | 'SILICONFLOW_API_KEY'
  | 'ZHIPU_API_KEY'
  | 'ARK_API_KEY'
  | 'DASHSCOPE_API_KEY';

export type StoredCredentials = Partial<Record<ProviderCredentialName, string>>;

export type CredentialStorageMode = 'encrypted-file' | 'session-memory';
