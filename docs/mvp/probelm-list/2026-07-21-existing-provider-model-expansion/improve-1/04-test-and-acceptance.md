# 4. 测试与验收标准

> 遵循 `docs/test-blueprint.md`。默认测试不读取真实 key、不访问厂商网络；live 测试仅在用户明确授权的本地环境执行。

## 4.1 测试范围

- Unit：ModelSpec 投影、未知模型前置拒绝、逐 profile 请求构造和响应解析。
- Contract：Provider/model DTO 不泄漏 profile，模型偏好和生成校验识别新增模型。
- Integration：MSW + 临时 SQLite/storage 验证生成、错误、Base64/URL 转存。
- Live/browser：逐模型 count=1 真实生成，确认任务终态、图片落盘、本地 API 可读。
- Smoke：typecheck/build/migration/health 不退化。

## 4.2 关键场景

| ID | 场景 | 类型 | 验证点 | Phase |
| --- | --- | --- | --- | --- |
| M01 | 七家现有模型迁移 | unit/contract | capabilities DTO 等价、profile 不可见 | 1 |
| M02 | 未知 model 直接 submit | unit | `INVALID_REQUEST/not_started`，fetch 未调用 | 1 |
| M03 | Provider profile 交叉污染 | unit | ZenMux/Doubao/SiliconFlow 只接受自身 profile | 1 |
| Z01 | GPT Image 1.5 请求 | unit/integration | 标准尺寸、count、Base64 解析与落盘 | 2 |
| D01 | Seedream 4.5 请求 | unit/integration | model、尺寸、禁用组图、count=1 | 2 |
| D02 | Seedream 5.0 Lite 请求 | unit/integration | 最终官方 model ID、禁止联网/组图 | 2 |
| S01 | Z-Image Turbo 探测成功 | live/browser | 本地生成、立即转存、重启仍可读 | 3 |
| S02 | Z-Image 探测失败 | live + catalog | 安全诊断；模型不进入可用目录 | 3 |
| S03 | Z-Image 不发送 Kolors-only 字段 | unit | 请求体没有未经支持的 `batch_size` | 3 |
| E01 | 401/429/5xx/timeout | unit/integration | 统一 code、diagnostic、disposition 与 durable wait 语义 | 2/3 |

## 4.3 Live 准入流程

每个模型按以下顺序执行，任一步失败即停止该模型，不继续扩大付费调用：

1. 确认 key 只显示“已配置”，不输出值。
2. 通过真实 3000 服务选择单 Provider、单模型、count=1、最低稳定尺寸。
3. 记录 generation ID、provider/model、开始/终态和安全 diagnostic；不记录签名 URL、响应体或 key。
4. 验证 `images.storage_path` 存在，文件字节数与 DB 一致。
5. 验证浏览器图片 `src=/api/images/:id`，重载仍显示。
6. URL 型结果验证 `result_snapshot` 已清理；Base64 型结果验证不会把 Base64 长期留在 job。

## 4.4 回归与发布门

```bash
npm run test:release
```

并要求：

- `/api/providers`、模型页、生成页只显示准入成功模型。
- Fal/ZenMux/Zhipu/Qwen 已有真实生成不退化；Kling 只做 mocked 回归。
- 3000 健康检查 schema/DB 正常。
- live 失败不会被 `test:release` 掩盖为成功，验收报告须逐模型列出结果。

## 4.5 对抗性审查

| 攻击面 | 防御 | 残余风险 |
| --- | --- | --- |
| model 字符串绕过 validator | adapter 再次 ModelSpec 查找 | 厂商可能在请求后下架模型 |
| profile 泄漏前端/DB | 仅 capabilities 投影；contract 断言无字段 | 内部深路径仍可 import，靠模块约定和 lint/code review |
| 真实测试误调用多张/高分辨率 | count=1、最低稳定尺寸、逐模型串行 | 仍产生真实费用 |
| URL 返回成功但转存失败 | integration + live 落盘/本地 API 断言 | 厂商 CDN 网络仍可能瞬态失败 |
| SiliconFlow 静态资料过期 | live probe 决定准入 | 后续仍可能下架，需维护时复测 |
