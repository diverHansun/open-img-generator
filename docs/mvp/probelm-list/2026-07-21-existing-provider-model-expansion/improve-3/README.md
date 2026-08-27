# Improve 3：ZenMux Gemini 与 Fal 扩展模型

> 状态：已实施并完成自动化、构建与真实 Provider 准入测试（2026-07-21）

## 目标模型

- ZenMux：`google/gemini-2.5-flash-image`、`google/gemini-3.1-flash-image`、`google/gemini-3-pro-image`、`google/gemini-3.1-flash-lite-image`。
- Fal：`fal-ai/nano-banana`、`google/nano-banana-lite`、`fal-ai/flux-2`、`fal-ai/flux-2-pro`、`fal-ai/flux-2-flex`、`fal-ai/flux-2/klein/4b`、`fal-ai/flux-2/klein/4b/base`。

官方核验纠正了最初候选名：`fal-ai/flux-2/klein/4b` 本身就是 4-step distilled；可调 CFG/28-step 版本的精确 ID 是 `/base`，不存在可发布的 `/distilled` 路径。

只开放文生图。图片编辑、LoRA、训练、Kontext 与多图融合不在本批。

## 文档地图

- [00-discussion.md](./00-discussion.md)
- [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)
- [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)
- [03-reference-projects.md](./03-reference-projects.md)
- [04-test-and-acceptance.md](./04-test-and-acceptance.md)

## 发布门

模型必须有官方模型 ID、请求 schema 单测、完整构建和真实凭据最小调用。真实调用失败的模型保留代码但不进入默认可用目录，不能用 mock 冒充准入。

## 真实准入结果

3000 端口持久化环境以单图、最低成本配置执行。`completed` 还必须同时满足本地文件存在且 `/api/images/:id` 返回 200，才记为通过。

| Provider | 模型 | 结果 |
| --- | --- | --- |
| ZenMux | `google/gemini-2.5-flash-image` | 通过，已转存本地 |
| ZenMux | `google/gemini-3-pro-image` | 通过，已转存本地 |
| ZenMux | `google/gemini-3.1-flash-lite-image` | 通过；最小尺寸的官方枚举值为 `512px`，不是 `512` |
| ZenMux | `google/gemini-3.1-flash-image` | 本轮返回 `PROVIDER_OUTCOME_UNKNOWN`；为避免重复计费不自动重试，不把它误判为不支持 |
| Fal | `fal-ai/nano-banana` | 通过，已转存本地 |
| Fal | `google/nano-banana-lite` | 通过，已转存本地 |
| Fal | `fal-ai/flux-2-pro` | 通过，已转存本地 |
| Fal | `fal-ai/flux-2-flex` | 通过，已转存本地 |
| Fal | `fal-ai/flux-2/klein/4b` | 通过，已转存本地 |
| Fal | `fal-ai/flux-2/klein/4b/base` | 通过，已转存本地 |
| Fal | `fal-ai/flux-2` | 本轮返回 `PROVIDER_OUTCOME_UNKNOWN`；保留代码与安全诊断，不自动重试 |

Fal 的 Klein 4B 路径按官方页面复核：`/4b` 是 distilled 版本，`/4b/base` 是可调 CFG 的 base 版本，不发布不存在的 `/distilled` 路径。
