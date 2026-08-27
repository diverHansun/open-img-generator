# 3. 官方资料借鉴

## 3.1 核对来源

| 来源 | 用途 |
|------|------|
| [图片生成与编辑](https://help.aliyun.com/zh/model-studio/image-model) | 当前 Qwen Image、Wan Image 模型目录、模式、数量和分辨率总览 |
| [Qwen Image 3.0 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference) | `qwen-image-3.0-pro`/`qwen-image-3.0` 的 sync/async endpoint、body、响应和模型限制 |
| [Qwen Image API](https://help.aliyun.com/zh/model-studio/qwen-image-api) | Qwen Image 2.0/Max/Plus/基础模型的当前接口和快照列表 |
| [模型上下架与更新](https://help.aliyun.com/zh/model-studio/newly-released-models) | `qwen-image-2.0-pro-2026-06-22` 与 `qwen-image-3.0-pro` 的发布时间和版本背景 |
| [Wan 2.7 图片 API](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference) | `wan2.7-image` 与 `wan2.7-image-pro` 的同步/异步端点和参数差异 |
| [限流](https://help.aliyun.com/zh/model-studio/rate-limit) | 新模型的接口类型和账号限流风险，仅用于验收提示，不进入公开 capabilities |

## 3.2 Adopt / Adapt / Reject

- Adopt：Qwen 3.0 与 Qwen 2.0 快照的 multimodal sync body、choices 图片响应和共享同步超时。
- Adopt：Wan 标准版的 multimodal sync endpoint；按官方文生图关闭 sequential，保留 thinking 参数语义。
- Adapt：官方支持的完整 I2I 能力暂不投影到产品，因为本批生成页仍是纯文生图。
- Reject：legacy `text2image/image-synthesis` 与 `qwen-image-plus`；用户已明确要求删除。
- Reject：运行时抓取百炼模型广场并自动发布；目录继续静态、可审查、可测试。
- Reject：把 Wan 标准版塞进 Qwen sync profile；`thinking_mode`、`enable_sequential` 和负面提示词支持集合不同。

## 3.3 官方信息对方案的直接影响

1. Qwen 3.0 API 文档同时给出 sync 与 async endpoint，但本批采用官方推荐的 sync 路径，避免新增 durable task 方言。
2. Qwen 3.0 和 Qwen 2.0 Pro 官方都支持图生图，但本产品能力声明受 UI 输入边界约束，只公开文生图。
3. `qwen-image-2.0-pro-2026-06-22` 是独立快照 model ID，不能只更新 `qwen-image-2.0-pro` alias。
4. Wan 2.7 标准版与 Pro 共用 provider 但协议和参数并非完全相同，必须有独立 profile。
