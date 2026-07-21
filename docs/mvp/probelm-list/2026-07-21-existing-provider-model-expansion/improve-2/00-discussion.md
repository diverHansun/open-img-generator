# 讨论记录与已确认要点

> 2026-07-21 与用户讨论确认。正式方案见 01–04。

## 1. 已确认目标

| Provider | 模型 | 本批模式 |
| --- | --- | --- |
| Fal | `fal-ai/nano-banana-2` | 文生图、Queue async |
| Fal | `fal-ai/nano-banana-pro` | 文生图、Queue async |
| Qwen | `qwen-image-2.0-pro` | 文生图；按官方可用同步多模态协议 |
| Qwen | `wan2.7-image-pro` | 文生图；优先异步任务协议 |

## 2. 已确认边界

- 不做图片编辑、多参考图、交互式编辑、组图生成或流式输出。
- 不把 Fal/Qwen 私有 profile 暴露到公开 capabilities。
- 用户已配置 Fal 与 Qwen 凭据并授权真实 count=1 生图测试。
- Qwen 沿用用户当前密钥对应的地区配置；不得在实现中静默切换北京/新加坡端点。
- Fal 继续直接使用 Queue HTTP，不引入 `@fal-ai/client` 的 subscribe 阻塞封装。

## 3. 与 Improve 1 的关系

本批只在已验收的 ModelSpec 结构上增加新 profile/模型，不再重构全 Provider 目录。若实践证明 ModelSpec 无法表达方言差异，应先修订 Improve 1 文档，而不是在 adapter 中堆临时分支。
