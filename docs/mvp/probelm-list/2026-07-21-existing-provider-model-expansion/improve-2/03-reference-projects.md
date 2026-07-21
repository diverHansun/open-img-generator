# 3. 官方资料借鉴

## 3.1 来源

| 模型 | 官方来源 | 采用信息 |
| --- | --- | --- |
| Nano Banana 2 | https://fal.ai/models/fal-ai/nano-banana-2/api | Queue、`aspect_ratio`、`resolution`、输出 images |
| Nano Banana Pro | https://fal.ai/models/fal-ai/nano-banana-pro/api | Queue、比例/分辨率和输出 schema |
| Qwen Image 2.0 Pro | https://help.aliyun.com/en/model-studio/qwen-image-api | 模型 ID、同步能力、尺寸、count |
| Wan 2.7 Image Pro | https://help.aliyun.com/en/model-studio/wan-image-generation-and-editing-api-reference | sync/async、地区端点、任务与结果 |
| Qwen 总览 | https://help.aliyun.com/en/model-studio/text-to-image | URL 24 小时、模型选择、协议与尺寸 |

## 3.2 Adopt / Adapt / Reject

- Adopt：Fal Queue submit/status/result 生命周期；与现有 durable job 完全匹配。
- Adapt：Fal 官方 SDK 示例只作为 schema 参考，实际仍用项目 HTTP client 和独立 poll。
- Adopt：Qwen Image 2.0 Pro 官方同步文本协议，但首批 count 保守为 1。
- Adapt：Wan 2.7 同时支持 sync/async，本产品优先 async，服务于重启恢复和长任务可靠性。
- Reject：本批暴露编辑、多图、组图、4K、web search/thinking；这些能力会改变 UI、费用和 capabilities 形态。
- Reject：北京/新加坡自动猜测；地区由用户当前配置明确决定。

## 3.3 对方案的影响

Fal “同 Queue、不同 body”与 Qwen “同 Provider、不同 lifecycle”证明 ModelSpec 必须同时描述请求 profile 和 protocol，但这些字段仍不应进入公开 DTO。
