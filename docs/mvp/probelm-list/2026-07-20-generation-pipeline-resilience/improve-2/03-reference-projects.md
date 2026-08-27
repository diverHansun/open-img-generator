# 3. 官方实现与 SDK 调研

## 3.1 调研来源

| 来源 | 链接 | 结论用途 |
|---|---|---|
| fal JavaScript Client | <https://fal.ai/docs/api-reference/client-libraries/javascript> | queue/subscribe/result 与输出形态 |
| fal Model APIs overview | <https://fal.ai/docs/documentation/model-apis/overview> | HTTP 与 SDK 共享的 CDN URL 输出 |
| fal-js repository | <https://github.com/fal-ai/fal-js> | SDK 以 platform `fetch` 为轻量底层 |
| ZenMux OpenAI Images API | <https://zenmux.ai/docs/api/openai/generate-an-image> | OpenAI-compatible endpoint、GPT image Base64 输出 |
| ZenMux image streaming | <https://zenmux.ai/docs/api/openai/image-generation-streaming-events.html> | 可选 SSE 与 final Base64 输出 |
| OpenAI Node SDK | <https://github.com/openai/openai-node> | 默认 timeout/retry 行为 |

## 3.2 可借鉴点

| 来源 | 做法 | 本项目取舍 |
|---|---|---|
| fal | `queue.submit/status/result` 将异步句柄与结果查询分开 | 已有 fal adapter 同样持久化 handle 并 poll；保持当前显式 lifecycle，避免 SDK 隐藏 checkpoint/lease |
| fal | SDK 的最终图片仍以 CDN URL 表达 | 不能消除透明代理下的 storage 下载问题；P1 必须在本项目 URL policy 修复 |
| ZenMux | OpenAI Images API 支持 Base64，另支持 SSE final event | 当前 inline staging 已安全处理 Base64；SSE 是未来改善进度体验的候选，不是本批超时修复前提 |
| OpenAI Node SDK | 可配置 timeout，但网络错误默认自动重试 | 不直接采用：对付费且非幂等的生成 submit，默认 retry 会违背 improve-1 的 outcome-unknown 策略 |

## 3.3 明确不借鉴

- 不以 `fal.subscribe()` 替换 durable job-engine。它对脚本方便，但会把本项目需要审计的 submit/poll/store checkpoint 隐入 SDK 控制流。
- 不以 OpenAI Node SDK 的十分钟默认 timeout 和两次默认 retry 取代现有策略；三分钟是本批明确的有界预算，重试仍由副作用分类决定。
- 不将 ZenMux streaming 作为规避 fal CDN 下载的通用手段；它只适用于 ZenMux 协议，改变的是结果传输和 UI 进度模型。

## 3.4 对 02 的影响

调研支持 D6：SDK 是调用便利层，不是代理 DNS/SSRF 或持久化副作用语义的解决方案。P1/P2 优先修复本仓库可控的 policy/timeout 边界；未来若产品需要 ZenMux 实时预览，再单独设计 SSE 的持久化、断线恢复和最终图片确认语义。
