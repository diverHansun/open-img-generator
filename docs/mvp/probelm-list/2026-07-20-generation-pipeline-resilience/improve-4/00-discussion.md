# 讨论记录与已确认要点

> 2026-07-21 根据真实环境事故分析与用户确认整理。证据见 01，实施契约见 02。

## 1. 背景与动机

用户发现此前生成和收藏的图片在服务重启、真实分支合并及 3000/3100 测试后不再显示。用户确认继续修复，并建议新增日志系统，要求修复完成后再讨论具体效果。

## 2. 已确认：产品语义

| 决策项 | 结论 |
|---|---|
| 收藏含义 | 收藏是用户的长期保留意图；外部文件缺失不能等价为用户取消收藏。 |
| 文件缺失 | 保留 Image 与 Favorite 身份，显示“收藏图片文件缺失”，不得伪装成未收藏、正常过期或 Provider 失败。 |
| 用户主动删除 | 单图主动删除或 Generation 聚合删除仍可删除对应 favorite；这是用户明确的破坏性意图。 |
| 自动 retention | 仍只处理超过保留期且未收藏的图片；默认 7 天。 |
| 恢复 | 优先恢复收藏元数据；图片字节只从本地备份、废纸篓或既有 Provider task/result 恢复，不自动重新生成。 |

## 3. 已确认：运行与存储边界

| 决策项 | 结论 |
|---|---|
| 产品运行形态 | 正式产品仍是本机单实例、单用户。 |
| 开发/测试现实 | 允许同时运行 3000/3100 或临时测试，但每个实例必须使用成对隔离的 DB 与 storage。 |
| 存储所有权 | cleanup 执行破坏性操作前必须证明当前数据库拥有该 storage root；无法证明则 fail closed。 |
| 多实例 | 不建设分布式锁服务；本地 marker + 文件锁满足当前约束。 |
| App 数据目录 | 当前继续支持显式 `DATABASE_URL`/`LOCAL_STORAGE_DIR`；未来宿主负责传入稳定绝对路径。 |

## 4. 已确认：日志边界

- 复用并扩展 `src/lib/observability/safe-logger.ts`，不并列建设第二套不一致 logger。
- 结构化日志同时写 stderr 和本地 JSONL；本地日志有固定大小与有限轮转，不无限增长。
- 记录事件类型、时间、结果、image/video ID、是否收藏、cleanup 运行 ID、所有权状态和安全错误码。
- 不记录 Prompt、API key、Provider 原始响应、Base64、签名 URL、绝对文件路径或任意异常 stack/message。
- 所有权不匹配、锁冲突、孤儿删除、文件缺失协调、恢复尝试均必须产生审计事件。
- 日志系统失败不能把正常请求变成更大的故障；但无法证明所有权时，orphan/retention 自动删除必须停止。

## 5. 本批不做

- 不上传日志，不加入 Sentry/Datadog/ELK 等远程服务。
- 不把日志作为恢复图片字节的备份。
- 不自动重做付费生成。
- 不引入 Redis、daemon 或独立清理服务。
- 不承诺恢复没有 Provider handle、没有上游历史且磁盘文件已消失的图片。

## 6. 与既有文档的关系

- [improve-3](../improve-3/README.md) 是现有图片墓碑与 retention 基线；本批仅 supersede “missing 时删除 favorite”及“storage root 默认独占”两项。
- [历史删除 improve-1](../../2026-07-20-provider-wait-and-history-delete/improve-1/README.md) 的显式 Generation 删除继续优先于 favorite，未被本批改变。
- `docs/test-blueprint.md` 是测试分层和临时 DB/storage 隔离的权威规则。
- `docs/mvp/storage/*`、`docs/mvp/library/*`、`docs/mvp/db/*` 与 `docs/mvp/api/constraints.md` 在实施完成后回写目标事实。
