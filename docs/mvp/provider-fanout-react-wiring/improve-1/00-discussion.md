# 讨论记录与已确认要点

> 2026-07-15 与用户确认。正式的现状诊断、实施契约和验收标准见本目录的 01、02、04。

## 1. 背景与动机

项目已具备 Fal 和 ZenMux 的单模型生成路径，但目标产品的操作流需要用户一次选择多个模型、提交一组公共参数，并在同一 generation 下查看各模型独立的进度、失败和图片结果。用户提供的演示图只作为操作/功能参照；本批先完成服务端与 React API 接线，不实现视觉 UI。

## 2. 已确认：目标与范围

| 决策项 | 结论 |
|---|---|
| 当前实现 Provider | Fal + ZenMux |
| 当前实现能力 | 仅文生图 |
| 提交模型 | 一个 generation 包含 `targets: [{ provider, model }]`；每个 target 创建一条 job |
| 执行方式 | target 独立提交；同步、异步和失败可并存；结果按 job 保留 |
| 总状态 | 所有 job 终结后，只要至少一条完成，generation 为 `completed`；失败详情保留在 job |
| Fal 公共参数 | 显式声明与映射公开宽高比，不再静默忽略 `aspectRatio` |
| seed | 对不支持 seed 的 target 省略该字段，不使整单失败 |
| negativePrompt | 只要任一 target 不支持且用户传入值，整单拒绝 |
| 并发轮询 | 使用独立、可过期的 `pollLeaseUntil`；`running` 始终是厂商真实状态 |
| 前端 | React 只实现 API 类型、请求客户端、能力推导、轮询控制器；不实现 UI/CSS |
| 密钥 | 项目根目录 `.env`；仅服务端读取，绝不向浏览器暴露 |

## 3. 已确认：后续 Provider 路线

SiliconFlow、Zhipu、Doubao、Qwen、Kling 都需要接入，但不属于本批 adapter 实现。每家首批能力均为文生图；后续以各厂商当期官方文档和测试凭据为准逐家接入。Qwen 默认北京区域。当前计划只保留统一的 ProviderId、capabilities 和 `.env` 命名边界，不伪造尚未验证的协议实现。

## 4. 已确认：边界与不做的事

| 项目 | 本批处理方式 |
|---|---|
| UI、CSS、页面布局、图片画廊 | 不做 |
| 旧顶层 `provider` / `model` POST 请求 | 不兼容；以 `targets[]` 作为唯一公开契约 |
| 图生图、视频、模型高级参数 | 不做 |
| 新后台队列、消息总线、微服务 | 不做；保留模块化 Next/SQLite 单体 |
| 自动重试、取消端点、认证和多租户 | 不做 |
| 后续五家 Provider 的真实调用 | 不做 |

## 5. 与既有文档的关系

`docs/mvp/` 是目标行为的权威来源；其中 2026-07-15 的 fan-out 与 web-ui 变更应作为本批方向。该变更区关于“只 claim `pending → running`”的描述会阻断后续对真实 `running` job 的轮询，本批以 `pollLeaseUntil` 修正，并同步更新相关 MVP 文档。

`docs/superpowers/specs/2026-07-15-fanout-and-frontend-design.md` 已被 MVP 文档标注为 superseded，不作为实现依据。

## 6. 用户确认记录

- 用户确认 Fal + ZenMux 当前接线、后续继续完成其余五家 Provider。
- 用户同意将轮询锁改为独立 `pollLeaseUntil`。
- 用户确认首批只做文生图，接受推荐的后续首模型路线，并指定 Qwen 默认北京区域。
- 用户确认密钥默认配置在 `.env`。
- 用户确认开始撰写文档并实施，且 UI 部分暂不做。
