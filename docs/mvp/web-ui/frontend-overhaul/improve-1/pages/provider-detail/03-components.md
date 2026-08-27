# Provider Detail · 组件

| 组件 | 职责 |
|---|---|
| `ProviderDetailPage` | summary 加载、空值映射 DELETE、draft 生命周期 |
| `ProviderIdentity` | name/mark/configured source |
| `ProviderConfigurationSection` | source 分支与说明 |
| `CredentialForm` | fixed credential label、draft、Save 与空值清除帮助文案 |
| `PasswordField` | shared 当前输入显隐 |
| `CredentialSourceLabel` | shared env/user-config/none |
| `ProviderApplicationLink` | shared：catalog 官方申请 API key 外链 |
| `ProviderCapabilities` | model/capability 只读摘要 |

`CredentialForm` 不接收 saved value 或 masked placeholder。页面 API payload 只包含 `{ value }`，credential name 只展示、不由表单提交；空草稿的 DELETE 映射封装在页容器而非拆出 Clear 控件。
