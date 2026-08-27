# Provider fan-out 与 React API 接线 · 改造计划

> 批次：`improve-1`
> 状态：已完成（2026-07-16）；本目录保留实施前基线与验收记录
> 范围基线：`docs/mvp/` 中 2026-07-15 的 fan-out / web-ui 变更

## 目标

将当前仅能提交单个 `provider + model` 的生成链路，改造成一次请求可向多个目标扇出，并为 React 前端提供不含 UI/CSS 的 API 数据层、能力推导与轮询状态管理。

本批实际接线 Fal 与 ZenMux；其余五家 Provider（SiliconFlow、Zhipu、Doubao、Qwen、Kling）只在本计划中冻结扩展边界、接入顺序与密钥约定，不在 `improve-1` 实现适配器。所有 Provider 的首个可用能力均为文生图。

## 已确认的约束与决策

- 外部 API 请求改为破坏性契约：`targets: [{ provider, model }]`，不保留顶层 `provider` / `model` shim。
- 一条 generation 对应多个 generation jobs；一个 target 对应一个 job。
- GET generation 会推进所有未终结的异步 job；任一 job 成功即可使全部终结后的 generation 聚合为 `completed`。
- 轮询互斥使用独立的 `pollLeaseUntil`，绝不以 `status = running` 充当锁。租约超时后允许恢复轮询。
- React 本批只实现客户端类型、API 调用、能力交集/参数推导、轮询控制器；不新增页面、组件视觉、UI 状态库或 CSS。
- Provider 密钥仅从项目根目录 `.env` 的服务端环境变量读取；不传入浏览器，不使用 `NEXT_PUBLIC_*`，也不提交真实密钥。
- Qwen 默认使用北京区域；它与其他后续 Provider 的具体模型、区域和协议在实际接入批次中以当时官方文档和测试凭据复核。

## 范围

### In scope（improve-1）

- Fal + ZenMux 的多 target 文生图提交、持久化、同步/异步执行、结果聚合与图片转存。
- `pollLeaseUntil` 数据模型、原子 claim、过期恢复和失败清理。
- Fal 公共宽高比能力声明及 adapter 映射，与 ZenMux 保持相同的公共入参语义。
- Next API 路由的 `targets[]` DTO 与 React 可消费的客户端数据层。
- 与上述变化相匹配的 unit、contract、integration 和 smoke 验收。

### Out of scope（improve-1）

- SiliconFlow、Zhipu、Doubao、Qwen、Kling 的生产 adapter、真实密钥或付费调用。
- 图生图、局部重绘、视频、文生视频、模型特有的高级参数。
- React 页面、UI 组件、样式、响应式布局、鉴权、多租户、后台 worker/队列、自动重试。
- 将模块化单体拆为微服务或新增消息总线。

## 文档阅读顺序

1. [00-discussion.md](./00-discussion.md)：已确认的对话结论与未决项。
2. [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)：当前实现与文档契约之间的差距。
3. [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)：供后续实施会话执行的分阶段契约。
4. [04-test-and-acceptance.md](./04-test-and-acceptance.md)：测试矩阵、验收条件和回归门禁。

本批不单列 `03-reference-projects.md`：架构不借鉴某个外部项目的实现；Provider 协议以各官方 API 文档为准，并将在相应接入批次重新核验。

## 实施交接规则

本目录是规划交付物，不包含实现。后续开发会话必须以 `02` 为改动边界、以 `04` 为验证门槛；任何扩大到新 Provider、UI/CSS 或新的异步基础设施的需求，都应先新增后续 `improve-*` 批次或更新本计划。
