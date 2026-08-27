# Providers · 组件

| 组件 | 职责 |
|---|---|
| `ProvidersPage` | 加载/自动重新验证固定 configuration catalog |
| `ProviderDirectory` | table/list collection |
| `ProviderDirectoryRow` | display/source/model counts/detail link |
| `ProviderMark` | 本地品牌/文字标记与 alt 规则 |
| `CredentialSourceLabel` | shared source 语义 |
| `ProviderApplicationLink` | shared：catalog 提供的官方申请 API key 外链 |
| `InlineNotice` | shared 加载失败 |

目录行接收 `ProviderConfiguration`，不接收 credential value。模型数由服务端摘要提供，不由 UI 根据当前 filtered rows 推断。
