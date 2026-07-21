# Improve 1：私有 ModelSpec 与同协议模型扩展

> 状态：规划完成，待用户审查后进入独立实施会话
>
> 基线：`mvp@a9d293b`

## 本批目标

1. 为七个 Provider 建立内部私有、按 Provider 强类型的 `ModelSpec`。
2. 保持公开 `ProviderCapabilities` 和现有模型行为不变地完成结构迁移。
3. 接入 ZenMux `openai/gpt-image-1.5`。
4. 接入 Doubao Seedream 4.5 与 5.0 Lite。
5. 真实探测 SiliconFlow `Tongyi-MAI/Z-Image-Turbo` 与 `Tongyi-MAI/Z-Image`；只有成功模型才进入正式目录。

## 文档地图

- [00-discussion.md](./00-discussion.md)：已确认范围与决策
- [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)：现状、问题和代码锚点
- [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)：后续实施契约
- [03-reference-projects.md](./03-reference-projects.md)：官方协议与本地资料的 adopt/adapt/reject
- [04-test-and-acceptance.md](./04-test-and-acceptance.md)：测试与发布门

## 明确不做

- 不改任何模型的编辑、多图或流式能力。
- 不运行时自动抓取厂商模型列表。
- 不把请求 profile 暴露给前端或写入数据库。
- 不因 SiliconFlow 探测失败而伪造 capabilities 或绕过官方限制。
