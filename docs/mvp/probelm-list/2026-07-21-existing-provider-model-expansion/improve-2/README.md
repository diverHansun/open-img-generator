# Improve 2：Fal 与 Qwen 新请求方言模型

> 状态：规划完成，须在 Improve 1 的 ModelSpec 基础设施验收后实施
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
