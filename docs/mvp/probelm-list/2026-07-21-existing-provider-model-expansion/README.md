# 现有 Provider 模型扩展与私有 ModelSpec

> 状态：Improve 1、Improve 2 已完成代码与自动化验证；真实准入结果见各批 README
>
> 日期：2026-07-21
>
> 基线：`mvp@a9d293b`

## 目标

在不改变 job-engine、storage 和公开 Provider 契约职责边界的前提下，为每个 Provider 建立内部私有的 `ModelSpec`，并分两批接入已确认的文生图模型。服务端模型 ID、请求方言、尺寸和结果形态变化时，只调整对应 Provider 的内部模型规格与测试。

## 批次

| 批次 | 目标 | 候选模型 | 文档 |
| --- | --- | --- | --- |
| Improve 1 | 全 Provider 私有 ModelSpec 基础设施；扩展同协议模型 | ZenMux GPT Image 1.5；Seedream 4.5/5.0 Lite；SiliconFlow Z-Image/Turbo | [improve-1](./improve-1/README.md) |
| Improve 2 | 使用 ModelSpec 增加新请求方言 | Fal Nano Banana 2/Pro；Qwen Image 2.0 Pro；Wan 2.7 Image Pro | [improve-2](./improve-2/README.md) |

## 2026-07-21 实施结论

- 七家现有 Provider 均已迁移到 Provider 内部私有 `ModelSpec`；未知模型会在发起网络请求前统一拒绝。
- Improve 1 已接入 GPT Image 1.5、Seedream 4.5/5.0 Lite 与 Z-Image Turbo。GPT Image 1.5 已完成真实闭环；SiliconFlow、Doubao 因凭据此前只存在于旧服务进程、没有持久化，重启后需用户重新保存凭据再补真实准入。
- `Tongyi-MAI/Z-Image` 没有在无法真实探测的情况下提前公开，避免目录展示一个尚未确认对当前账户可用的模型。
- Improve 2 四个模型均完成真实 3000 端口闭环：Provider 返回、job 状态、远端图片立即转存、本地图片读取均成功。
- Qwen 与 SiliconFlow 的图片 CDN 会受到本机代理 fake-IP 映射影响；本次只按安全诊断暴露出的精确 hostname 加入可信转存名单，没有建设通用代理路由层。

## 统一边界

- 本议题只扩展当前七家 Provider，不增加新 Provider。
- 两批均只做文生图；图片编辑、多图融合、组图生成、流式输出不在范围内。
- `ModelSpec` 是 `src/lib/providers/` 内部实现，不进入 `ProviderCapabilities`、Web API DTO、数据库或 job snapshot。
- 不引入厂商 SDK、动态插件系统、远程模型自动同步或通用 Provider DSL。
- 所有模型先完成官方文档核验和请求/响应测试；真实凭据测试成功后才能作为可用模型交付。
- 用户已授权使用已配置的真实 Provider 凭据执行最小成本生图验证；Kling 未配置且本议题没有 Kling 新模型。

## 阅读顺序

每个批次均按 `README → 00 → 01 → 02 → 03 → 04` 阅读。`02` 是后续独立实施会话的改动契约，`04` 是测试与验收契约。

## 权威关系

- Providers 模块稳定职责仍以 `docs/mvp/providers/` 为准。
- 本文档集补充“单 Provider 多模型、多请求方言”的演进方案；实施完成后应同步更新 providers 的 architecture、data-model、dfd-interface 与 test 文档。
- `model-interface-docs/` 是本地资料快照；实施时必须以当日官方页面与真实 API 响应为最终事实。
