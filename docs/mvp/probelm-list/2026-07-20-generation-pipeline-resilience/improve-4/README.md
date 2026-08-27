# 存储所有权、收藏墓碑与本地审计日志 · improve-4

> 状态：方案待用户审查；实施必须在独立会话按 02 + 04 执行。
>
> 日期：2026-07-21
>
> 代码基线：`mvp@137d725`
>
> 前置批次：[improve-3](../improve-3/README.md)

## 为什么需要本批

真实环境仍保留 36 条 Generation 和 30 条图片记录，但旧图片中的 21 张已失去本地文件，随后在 2026-07-21 16:13:00–16:13:09 被读取路径协调为 `storage_missing`。该协调同时删除了 3 条收藏关系，使 Gallery 错误显示为“还没有收藏图片”。迁移前备份证明三条收藏意图真实存在。

本批修正两个承重问题：文件缺失不能抹掉用户收藏意图；一个数据库不能把另一个数据库管理的同目录文件当成孤儿删除。同时建立持久、脱敏、可界定大小的本地审计日志，让后续删除可追溯。

## 范围

### In scope

- `storage_missing` 保留 favorite；Gallery 展示不可用收藏墓碑并允许用户主动取消收藏。
- SQLite/Storage Root 所有权标记和 cleanup 独占锁；所有权无法证明时停止破坏性存储操作。
- orphan 扫描把 image、video 和 durable staging 引用统一视为受管媒体，避免 Seedance MP4 被误删。
- 扩展现有 `safe-logger`，新增固定 schema 的本地 JSONL 日志、大小轮转及 storage audit 事件。
- 测试/临时实例必须成对隔离 `DATABASE_URL` 与 `LOCAL_STORAGE_DIR`。
- 从 `app.db.pre-migrate-v4-to-v5.bak` 恢复三条收藏元数据；在安全修复完成后，按 Provider handle 尝试非生成式、非计费式结果恢复。
- 回写 storage/library/db/api/web-client/web-ui/observability 文档和 improve-3 的 superseded 条款。

### Out of scope

- 云日志、日志上传、遥测 SaaS、用户行为分析或远程控制。
- 自研对象存储、图片 BLOB 入库、RAID/备份产品或跨设备同步。
- 自动重新提交生成任务；恢复只允许读取既有 Provider task/result。
- 在 App 宿主尚未确定前硬编码 macOS/Windows/Linux Application Support 路径。
- 把单机产品升级为多实例分布式媒体服务。

## 文档地图

1. [00-discussion.md](./00-discussion.md)：已确认的产品语义与本批边界。
2. [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)：事故证据、代码基线和设计缺口。
3. [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)：后续实施契约、恢复顺序和回滚。
4. `03-reference-projects.md`：本议题由本地事故和既有代码充分驱动，无外部参考项目，故不创建。
5. [04-test-and-acceptance.md](./04-test-and-acceptance.md)：风险导向测试与发布门。

## Supersede 说明

本批只废止 improve-3 中两项错误条款：

- `storage_missing` 不再删除 favorite；收藏意图保留到用户主动取消收藏或执行显式删除。
- orphan cleanup 不再默认假设当前 DB 独占 `LOCAL_STORAGE_DIR`。

improve-3 的 Base64 优先、立即转存、7 天未收藏保留期、图片墓碑、下载不续期和 Generation 历史保留继续有效。
