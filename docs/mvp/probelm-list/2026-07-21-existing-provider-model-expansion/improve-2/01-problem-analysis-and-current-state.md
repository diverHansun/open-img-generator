# 1. 问题分析与当前状态

> 时间口径：以 Improve 1 验收完成后的 `mvp` 为实施基线；当前代码锚点仍参考 `mvp@a9d293b`。

## 1.1 Fal 差距

`src/lib/providers/adapters/fal.ts` 已正确实现 Queue submit/poll/cancel 与受信 handle URL，但 `buildBody()` 主要面向 FLUX：公开比例被翻译为 `image_size`。Nano Banana 2/Pro 官方 schema 使用 `aspect_ratio`、`resolution`、`num_images`，若只新增 capabilities 会发送语义错误的请求。

现有 `parseImages()` 已能解析统一 `images[]` URL，job handle 生命周期可复用；因此差异应被限制在 Fal ModelSpec profile 和请求 builder，不需要新增 Provider 或 job 状态。

## 1.2 Qwen 差距

`src/lib/providers/adapters/qwen.ts` 当前面向 `qwen-image-plus` 的 legacy async `text2image/image-synthesis`：`input.prompt + parameters`，返回 `task_id` 后 poll。

- `qwen-image-2.0-pro` 官方推荐同步 multimodal generation，请求为 `input.messages[].content[].text`。
- `wan2.7-image-pro` 支持同步和异步；为减少长连接失败面，本产品优先使用异步任务路径，但仍只发送纯文本、单图输出参数。
- 北京与新加坡密钥/端点不能互换，当前单一 base 配置必须显式复用，不能硬编码第二地区。

## 1.3 公共能力模型的限制

当前公开 capabilities 足以描述本批的文生图、数量、比例和 protocol。因为编辑/组图被明确排除，本批不需要引入按 mode 嵌套的复杂 capabilities。未来开启编辑时再单独设计 `modeCapabilities`，符合 YAGNI。

## 1.4 数据流与可靠性

- Fal async：submit 30 秒边界 → durable handle → worker/poll → URL → storage。
- Qwen 2.0 sync：最多 180 秒完整响应 → URL/Base64 → storage；请求超时 disposition=`unknown`，不得自动重投。
- Wan 2.7 async：submit → task handle → durable poll → 24 小时临时 URL → 立即 storage。

主要风险不是 job-engine，而是 profile 选择错误、区域端点不匹配、sync/async 响应形态混用，以及成功后未及时转存。

## 1.5 测试缺口

- Fal unit test 只有 FLUX body 映射，没有按 profile 的字段互斥断言。
- Qwen unit test 只有 legacy async，没有同一 adapter 同时返回 sync/async 的矩阵。
- integration 尚未覆盖同 Provider 不同 model protocol 的完整 job lifecycle。
- 真实环境需逐模型验证费用请求、终态、落盘、重载与安全 diagnostic。

## 1.6 SWE 审视

- 复用 Queue/job lifecycle，避免把请求方言差异升级为新 Provider。
- 用离散 profile 而不是自由字符串/万能 options，减少非法组合。
- 只做已有文生图需求，不预先构建编辑、多图、流式抽象。
- 同一 Qwen adapter 支持 sync/async 是真实本质复杂度；应显式表达，不能隐藏成偶然控制流。
