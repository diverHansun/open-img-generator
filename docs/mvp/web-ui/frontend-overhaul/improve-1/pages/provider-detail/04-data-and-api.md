# Provider Detail · 数据与 API

## 数据流

1. 读取 `GET /api/provider-configurations` 并按 providerId 取项，或后续增加等价单项 GET；首批不必多建 endpoint。
2. Save 非空 draft：`PUT /api/provider-configurations/:providerId/credential { value }`。
3. Save 空 draft：仅已配置 user-config 时映射为 `DELETE /api/provider-configurations/:providerId/credential`；未配置时不发请求。
4. 服务端固定映射 providerId → credentialName，序列化 merge-write 加密文件。
5. 返回无 secret `ProviderConfiguration`。

## 安全契约

- env source PUT/DELETE → 409 `CREDENTIAL_MANAGED_BY_ENV`。
- PUT value 空/过长 → 400；unknown provider → 404；缺 encryption key → 配置型 503。UI 对未配置的空 draft 在浏览器内就地校验，不依赖此错误。
- response、error、console、URL、analytics 不含 value。
- GET/PUT/DELETE 使用 `no-store`；沿用 APP_AUTH_TOKEN same-origin 认证。

## 所有权

provider-config service 负责编排与 DTO allowlist；user-config 负责加密文件；env 由进程环境拥有；页面只拥有未提交 draft。

## 并发

服务端串行 `read all → merge/remove target → atomic write all`。两个 Provider 并发保存不得最后写覆盖前一次。多进程文件锁后置，本地单进程 MVP 明确此限制。
