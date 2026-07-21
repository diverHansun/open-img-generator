# Improve 2：Fal 与 Qwen 新请求方言模型

> 状态：已实施并通过自动化测试与真实 Provider E2E（2026-07-21）
>
> 基线：Improve 1 验收通过的 `mvp`

## 本批目标

- Fal：`fal-ai/nano-banana-2`、`fal-ai/nano-banana-pro`。
- Qwen：`qwen-image-2.0-pro`、`wan2.7-image-pro`。
- 只开放文生图能力；明确关闭图片编辑、多图融合、连续组图和流式输出。
- 复用已有 job-engine、三分钟同步预算、安全 HTTP、错误诊断和立即转存。

## 文档地图

- [00-discussion.md](./00-discussion.md)
- [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)
- [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)
- [03-reference-projects.md](./03-reference-projects.md)
- [04-test-and-acceptance.md](./04-test-and-acceptance.md)

## 前置门禁

Improve 1 的七家 ModelSpec 迁移、完整 `test:release` 和至少一轮真实模型准入必须通过；否则本批不开始。

## 实施结果

| Provider | 模型 | 协议 profile | 真实 3000 E2E |
| --- | --- | --- | --- |
| Fal | `fal-ai/nano-banana-2` | `banana-aspect-ratio` + queue async | 成功，图片已立即转存并可从本地图片 API 读取 |
| Fal | `fal-ai/nano-banana-pro` | `banana-aspect-ratio` + queue async | 成功，图片已立即转存并可从本地图片 API 读取 |
| Qwen | `qwen-image-2.0-pro` | `multimodal-sync` | 成功，图片已立即转存并可从本地图片 API 读取 |
| Qwen | `wan2.7-image-pro` | `multimodal-async` | 成功，图片已立即转存并可从本地图片 API 读取 |

实现保持文生图边界：没有向公开能力声明图片编辑、多图融合、连续组图或流式输出。Qwen 2.0 Pro 复用三分钟同步预算；Wan 复用既有异步 job 轮询。Fal Banana 仅投影其官方支持的 `aspect_ratio`、`resolution`、`num_images`、`seed` 与安全级别选项，防止旧 FLUX 参数泄漏。

## 真实网络诊断

Qwen 首次真实请求已经成功返回图片 URL，但转存阶段拒绝了代理产生的 fake-IP 映射，诊断为 `proxy_mapping_not_trusted`。确认真实响应 hostname 后，将 `dashscope-7c2c.oss-accelerate.aliyuncs.com` 作为精确可信 CDN host 配置，复测完整成功。该处理保留 SSRF/fake-IP 安全边界，不扩展为通用代理发现或路由系统。
