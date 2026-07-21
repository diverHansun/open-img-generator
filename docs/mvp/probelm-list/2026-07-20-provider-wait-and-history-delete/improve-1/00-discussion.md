# 讨论记录与已确认要点

> 2026-07-20 与用户讨论定稿。正式实施契约见 `01`、`02`、`04`。

## 1. 背景与动机

用户需要在第一个 Generation 仍运行时返回编辑页，修改 prompt 和多选模型后提交第二个 Generation。两者应独立持久化和推进，而不是被同一 Provider 的本地并发槽或页面轮询生命周期阻塞。

用户还需要在 Project 下按 Session 分组的历史记录中，主动删除冗余、失败或已完成的整条 Generation。

2026-07-21 的后续讨论进一步确认图片生命周期：未收藏图片默认 7 天后只清理文件并保留图片墓碑；收藏图片持续保留；单图主动删除同样保留 Generation/Job/Prompt/Provider error。Generation 历史删除必须与这些语义区分，不能把自动图片清理实现成历史删除。

## 2. 已确认：目标与范围

| 决策项 | 已确认结论 |
|---|---|
| 后端部署 | 单个常驻 Node.js 后端实例。Web 与未来 App 均为客户端，不是后端实例。 |
| 后台推进 | 生产环境必须启用同进程 durable worker（`JOB_WORKER_ENABLED=true`）；用户离开 Generation 详情页后任务仍继续推进。 |
| Provider 并发 | 不设置本地按 Provider 的并发槽、等待队列或队列超时；Provider 服务端决定是否接纳、排队或拒绝。 |
| 厂商明确限流 | Provider 明确、可安全重试的并发/限流拒绝后，job 一直保持等待并自动重试，直到成功或用户取消。 |
| 不确定 submit | HTTP 超时、连接中断或 5xx 不盲目重投；保持既有 `outcome_unknown` 防重复计费语义。 |
| 多模型 | 不设置 Generation 的业务 target 数量硬上限；每个合法、去重的 target 均应入队。 |
| 自动图片保留期 | 未收藏图片默认 7 天后只清理字节并保留 `retention_expired` 墓碑；不删除 Generation、Job、Prompt 或 Provider error。由关联 improve-3 实施。 |
| 单图主动删除 | 只删除该图片字节并保留 `user_deleted` 墓碑；不删除所属 Generation 历史。由关联 improve-3 实施。 |
| Generation 历史删除 | 增加用户主动发起的 Generation 级硬删除；删除整个 Generation 聚合，包括 jobs、available/tombstone 图片记录、收藏和仍存在的本地图片文件。 |
| 收藏与整条删除 | 收藏阻止自动 retention，但不阻止用户明确删除整条 Generation；确认文案必须说明收藏也会被删除。 |
| 下载副本 | Generation 删除只处理应用管理的记录与文件，不删除用户已下载/导出的外部副本。 |
| 删除竞态 | `cancelling` 不可删除；`outcome_unknown` 要在 UI 进行“仅删除本地记录”的明确二次确认。 |

## 3. 已确认：边界

| 项 | 本批不做 |
|---|---|
| 横向扩容 | 不引入多实例协调、分布式限流、Celery 或消息中间件。 |
| 用户治理 | 不新增多用户、配额、优先级或公平调度。 |
| 厂商保证 | 不承诺厂商一定会排队；若厂商返回明确限流，系统只负责持久化等待并重试。 |
| Session/Project | 不删除 Session 或 Project，不改变它们的归属和列表语义。 |
| 自动历史清理 | 不按 7 天或其他保留期自动删除 Generation/Job/Prompt/Provider error。 |
| 回收站 | Generation 硬删除不可恢复；本批不引入回收站或软删除整条 Generation。 |

## 4. 与既有模块文档的关系

- `docs/mvp/job-engine/*` 是 job-engine 的既有设计基线。
- 本批需要修订其中“per-provider semaphore”“有界 submit 重排”“示例环境默认关闭 worker”等与本次确认冲突的描述。
- `docs/test-blueprint.md` 是项目测试规则的权威来源；本批的 `04` 仅补充特定风险和验收。
- [生成管线 improve-3](../../2026-07-20-generation-pipeline-resilience/improve-3/README.md) 是图片内联、7 天 retention、墓碑、单图下载/删除与 410 状态的实施契约。本批 Phase 3 消费该图片模型，不得重新定义一套冲突的图片生命周期。

## 5. 用户确认记录

- 用户确认单实例，不做多实例部署。
- 用户确认厂商持续返回并发上限时，任务一直等待，直到用户取消。
- 用户确认不把多模型任务数量固定为 8。
- 用户确认历史删除及其删除竞态规则。
- 用户确认自动 retention 与单图删除继续保留任务/提示词/Provider 错误/生成记录；只有明确的 Generation 删除动作才移除整条历史。
