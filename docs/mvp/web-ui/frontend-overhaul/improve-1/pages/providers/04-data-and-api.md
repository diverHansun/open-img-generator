# Providers · 数据与 API

## 数据流

1. `GET /api/provider-configurations`。
2. provider-config service 组合固定 catalog、credential source、capabilities、model preferences 与经 allowlist 校验的官方 `keyApplyUrl`。
3. 返回七个无 secret summary。
4. UI 排列并进入详情。

## 契约

`ProviderConfiguration` 以根级 `02 §2.5.5` 为准。顺序固定：fal、zenmux、siliconflow、zhipu、doubao、qwen、kling。Kling credentialName 为 `KLING_API_KEY`，Qwen 为 `DASHSCOPE_API_KEY`。

## 所有权

catalog/capability 属于 providers/provider-config；secret source 判断属于 user-config resolution；列表只是只读消费者。route projectId 不过滤全局配置。

## Cache

响应 `no-store` 或短生命周期；页面挂载/重新可见时自动重取。任何浏览器 cache 中都只有摘要。
