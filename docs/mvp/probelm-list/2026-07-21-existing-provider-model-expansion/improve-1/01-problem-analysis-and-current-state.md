# 1. 问题分析与当前状态

> 时间口径：2026-07-21，`mvp@a9d293b`。

## 1.1 核心问题

1. `src/lib/providers/types.ts` 的公开 `ProviderCapabilities` 适合 UI 和 job 校验，但只有 `protocol: sync|async`，不能表达同一 Provider 内部的请求方言。
2. `src/lib/providers/adapters/*.ts` 中的尺寸映射、请求构造和响应解析按“当前唯一模型”编写；直接继续添加条件分支会让 adapter 随模型数量线性失控。
3. `src/lib/providers/capabilities/*.ts` 只有公开 capabilities；缺少“模型 → 私有 profile → 构造/解析策略”的内部单一事实源。
4. SiliconFlow 官方明确模型会动态上下架，静态文档中出现 model ID 不等于当前账户真实可调用。

## 1.2 产品与技术分界

公开世界只需要知道模型名称、模式、尺寸、数量和 sync/async；厂商端点、请求字段、结果字段、默认参数属于 Provider 内部。`ModelSpec` 必须强化这条信息隐藏边界，而不是创造第二套公开模型 API。

## 1.3 Providers 模块现状

### goals-duty

`docs/mvp/providers/goals-duty.md` 要求 adapter 隔离厂商差异。当前七个 adapter 已做到 Provider 级隔离，但尚未做到 Provider 内的模型方言隔离。

### architecture

- `src/lib/providers/registry.ts`：按 Provider 懒初始化，结构可继续保留。
- `src/lib/provider-config/catalog.ts`：直接导入各 capabilities 数组，适合公开静态目录。
- `src/lib/providers/adapters/zenmux.ts`：统一构造 OpenAI Images 请求，适合 GPT Image 1.5/2，但 profile 没有显式化。
- `src/lib/providers/adapters/doubao.ts`：统一 Ark Images 请求，当前 model 参数可变，但尺寸、输出格式和能力仍按 Seedream 4.0 假设。
- `src/lib/providers/adapters/siliconflow.ts`：`batch_size`、尺寸映射和可选字段并非所有模型通用；官方文档已明确 `batch_size` 仅适用于 Kolors。

### data-model

- `ProviderCapabilities` 是公开值对象，应保持纯净。
- generation jobs 已把 model 存为字符串，不需要把 profile 持久化；重试时通过当前代码的 ModelSpec 解析同一个 model。
- 风险：如果模型 ID 被删除，历史 job 的未完成 snapshot 将无法 dispatch。实施应保留既有模型 spec，不以新增模型为由删除旧项。

### dfd-interface

当前数据流为：catalog/capabilities → UI/job validation → adapter `submit(req, model)` → HTTP → `ProviderImageRef` → storage。缺口位于 `submit` 内没有显式的 `model → spec` 查找，未知模型防线主要依赖上层 validator。

### use-case

- 已配置 Provider 的用户可在模型页启停模型，并在生成页选择目标。
- 新模型进入目录后沿用现有“无 preference 默认启用”语义；不会自动发起生成，只有用户选择并提交才产生费用。
- SiliconFlow 候选必须先 live probe，避免用户看到必然失败的模型。

### non-functional

| 属性 | 当前状态 | 风险 |
| --- | --- | --- |
| 可维护性 | 每 Provider 独立 adapter | 同 Provider 多模型条件分支将膨胀 |
| 可靠性 | 安全 HTTP、超时、错误诊断、立即转存已存在 | 错误请求 profile 会造成付费失败或 URL 过期 |
| 安全 | key 只在服务端解析 | ModelSpec 不得携带或输出 key、URL token |
| 可观测性 | 有统一 diagnostic | live probe 需记录安全的 provider/model/request-id，不记录 prompt/响应体/key |

### test

现有 adapter unit test 覆盖请求体和响应解析，integration 使用 MSW，真实 Provider 只在用户授权时手工验收。缺少按 model profile 参数化的测试矩阵和模型准入测试。

## 1.4 跨模块一致性

- job-engine 只依赖 `ImageProvider` 与公开 capabilities，ModelSpec 不应进入 job-engine。
- storage 已支持 data URL 与远程 URL；新增模型必须继续输出统一 `ProviderImageRef`。
- provider-config 只序列化 capabilities 投影，不得泄漏内部 profile。
- web-client 类型无需新增字段。

## 1.5 文档与实现差距

| 文档说 | 代码做 | Gap |
| --- | --- | --- |
| capabilities 与 adapter 正交 | capabilities 独立文件，但 adapter 内仍有隐式单模型假设 | 需要 ModelSpec 连接二者 |
| 加模型成本低 | 同协议模型可只加 capability，但模型特例无结构归属 | 容易堆 `if (model)` |
| 静态目录随代码部署 | 没有 live 准入门 | 动态上下架厂商可能产生失真目录 |

## 1.6 SWE 原则审视

- 信息隐藏：profile 应藏在 Provider 内，避免厂商变化扩散到 UI/job/storage。
- KISS/YAGNI：不构建通用 DSL；只有已经出现的方言才定义 profile。
- 高内聚：请求构造、响应解析与其 model profile 同属一个 Provider。
- 可验证性：先完成无行为变化的结构迁移，再逐模型增加，降低回归定位成本。

## 1.7 与既有文档关系

本议题不取代 `docs/mvp/providers/` 的稳定模块边界，只补充多模型演进契约。实施完成后应回写权威模块文档和 `model-interface-docs/` 的核验日期。
