# Provider 等待与 Generation 历史删除 · improve-1

> 状态：已完成实施与自动化验证；等待合入 `mvp` 后执行真实 Provider 并发验收。
>
> 范围：单实例后台 worker、Provider 拥塞等待、多模型 target 数量、用户主动发起的 Generation 历史硬删除。
>
> 关联契约：[生成管线 improve-3：内联优先、7 天保留与图片墓碑](../../2026-07-20-generation-pipeline-resilience/improve-3/README.md)

## 文档地图

1. [00-discussion.md](./00-discussion.md)：用户已确认的产品和部署决策。
2. [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)：当前实现与风险基线。
3. [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)：实施契约、阶段和改动面。
4. `03-reference-projects.md`：本批没有用户指定或必须借鉴的外部项目，故不创建。
5. [04-test-and-acceptance.md](./04-test-and-acceptance.md)：测试和发布验收标准。

## 本批范围

- 单个常驻 Node.js 后端实例内启用 durable job worker；Web 与 App 只是该后端的客户端。
- 移除本地 Provider 并发槽和本地 Provider 等待队列；将厂商明确拒绝的限流转化为可取消、可恢复的持久化等待。
- 移除一次 Generation 最多 8 个 `targets` 的业务硬上限；保留 worker 的内部扫描分页，不拒绝已校验的任务。
- 新增按 Generation **主动删除整条生成记录**的 API、仍存图片文件清理和 History UI 操作。
- 明确区分三种动作：自动保留期清理只移除图片字节并留墓碑；单图删除只移除该图片字节并留墓碑；Generation 删除才硬删除整个 Generation/Job/Image/Favorite 聚合。

## 不在本批

- 多实例、Celery、Redis/RabbitMQ、分布式限流或独立 worker 服务。
- 多用户配额、公平调度、按用户限流。
- 真实厂商 API 的自动化测试或付费 live 测试。
- Session 或 Project 的删除语义调整。
- 自动删除 Generation 历史、按时间清理 Prompt/Job/Provider error，或把单图删除实现成 Generation 删除。

## 实施约束

实现必须继续保持关联 improve-3 的 schema v4/图片墓碑后端契约。本方案不授权把「Provider 请求超时、断线或 5xx」当成可无限重投：只有 Provider 明确拒绝且标为可重试的限流结果才能进入持久等待。
