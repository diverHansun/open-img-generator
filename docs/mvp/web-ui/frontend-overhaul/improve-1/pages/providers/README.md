# Providers

## Design Goals

- 以固定、诚实的目录说明系统支持的七家 Provider 及配置状态。
- 把“有凭证”与“网络已连接”严格区分。
- 为 Provider Detail 提供清晰入口，不在列表塞入敏感表单。

## Duties

1. 固定展示七家 Provider。
2. 展示 credential source、configured、available/enabled model 数。
3. 展示每家官方申请 API key 的外部链接，并导航到单 Provider Detail。
4. 进入页面与标签页重新可见时自动重新读取服务端配置摘要。

## Non-Duties

- 不 Add provider。
- 不显示 Connected、Last checked、余额、域名或远端健康，除非未来真实实现 probe。
- 不在列表编辑/回显密钥。

路由：`/workspace/:projectId/providers`；配置为全局作用域。
