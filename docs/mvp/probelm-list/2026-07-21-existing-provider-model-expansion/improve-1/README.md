# Improve 1：私有 ModelSpec 与同协议模型扩展

> 状态：代码与自动化验证完成；部分真实 Provider 准入待密钥恢复
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

## 2026-07-21 实施状态

- 七个 Provider 已迁移到内部 ModelSpec；未知模型在发出网络请求前统一返回 `INVALID_REQUEST/not_started`。
- ZenMux `openai/gpt-image-1.5` 已经真实 3000 链路生成并落盘，可经本地图片 API 读取。
- SiliconFlow `Tongyi-MAI/Z-Image-Turbo` 已被真实 Provider 接受并返回图片 URL；首次转存因 Clash Fake-IP 未配置精确主机 `s3.siliconflow.cn` 而安全失败，该主机现已加入本机测试配置。
- 重启后发现 SiliconFlow 与 Doubao 密钥只存在于旧进程环境，未持久化到 `.env`/user-config；因此 Turbo 的配置后复测、`Tongyi-MAI/Z-Image` 准入探测与 Doubao 两个新模型实测待重新保存密钥。
- `Tongyi-MAI/Z-Image` 在完整产品链路验证前不进入公开 capabilities；不以 mocked test 代替动态模型可用性探测。
