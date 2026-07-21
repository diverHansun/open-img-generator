# 1. 问题分析与当前状态

ZenMux 现有 adapter 只实现 OpenAI Images `/api/v1/images/generations`。Google 图片模型使用 Vertex-compatible `generateContent`，请求是 `contents[].parts[].text`，图片位于 `candidates[].content.parts[].inlineData`；只加 capabilities 会调用错误端点。

Fal 已有可靠 Queue submit/poll/cancel，但当前 FLUX profile 会把任意 `providerOptions` 透传，且 Nano Banana 2/Pro 的 profile 不能精确代表原版、Lite 与各 FLUX 2 变体。差异应留在 Fal 私有 profile 和 allowlist builder。

任务引擎与图片存储无需改动：ZenMux Base64 可进入 staging，Fal URL 可立即转存。风险集中在模型 ID、请求字段互斥、比例/分辨率枚举和官方 schema 演进。
