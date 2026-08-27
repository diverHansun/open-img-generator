# 2. 优化方案与改动面

## 2.1 方案总览

采用一个模块化单体内的最小闭环：Favorite 持久表达用户意图；Image/Video tombstone 表达字节事实；storage ownership 在任何受管文件操作前证明 DB/root 配对；cleanup 用本地独占锁串行；observability 用单一脱敏事件入口写 stderr 与有界 JSONL。

```text
DB canonical path ──SHA-256──┐
                              ├─ verify .open-image-storage.json
Storage canonical root ───────┘              │
                                             ├─ mismatch → log + refuse destructive operation
                                             └─ match → acquire cleanup lock
                                                           │
                  images + videos + durable staging refs ──┤
                                                           ↓
                                                retention/orphan cleanup
                                                           ↓
                                                bounded audit JSONL
```

## 2.2 设计决策

| 决策 | 选择 | 理由 | 代价/放弃 |
|---|---|---|---|
| Missing favorite | 保留 favorite，Gallery 显示 tombstone | Favorite 是用户意图，不是文件健康探针 | Gallery DTO/UI 需要 nullable URL |
| GET missing 协调 | 保留幂等 `storage_missing` 写入，但不删除 favorite | 最小修改且历史能立即解释 | GET 仍有诊断副作用；不引入异步事件系统 |
| Storage ownership | root marker 保存 canonical DB path 的 SHA-256 和协议版本 | 不写绝对路径，能识别不同临时 DB 共用 root | DB 合法搬迁后需显式重新认领；默认 fail closed |
| 首次认领 | root 空，或所有正式媒体文件与当前 DB live refs 精确一致时原子创建 marker | 兼容现有安装，同时不吞掉未知文件 | 不一致需维护操作，不能自动猜测 |
| Cleanup 并发 | storage root 内本地 lock file，含 bounded 元数据和 stale 处理 | 当前单机足够，避免重叠清理 | 不解决跨机器共享目录，明确 out-of-scope |
| Reference set | images + videos + durable staging +内部保留文件 | 防止 Seedance MP4、marker、lock 被当 orphan | cleanup 需从媒体级查询读取 |
| 日志 | 扩展 safe logger，stderr + `APP_LOG_DIR` JSONL，固定大小轮转 | 既可实时看，也可在重启后取证 | 不是图片备份；写入失败只能降级 |
| 日志字段 | allowlist 固定 schema、长度上限、路径只记录 hash/相对标识 | 防密钥、Prompt、签名 URL 和绝对路径泄漏 | 取证细节受限，但足以关联 DB/image/run |
| 数据恢复 | 先修语义，再恢复 3 favorite；后续只读 poll 既有 handle | 不让恢复数据被旧逻辑再次删除，不产生新费用 | 无 handle 的字节可能无法恢复 |

## 2.3 Phase 1：先冻结正确业务不变量

### 改动

- `src/lib/db/queries/images.ts`
  - `markImageStorageMissing` 不再删除 favorites。
  - 保持 `markImageUserDeleted` 与 Generation DELETE 的显式删除语义。
- `src/lib/library/favorites.ts`
  - list query 不再排除 tombstone；返回 availability、removedAt、nullable URL。
  - addFavorite 仍只允许 available image。
- `src/lib/library/types.ts`、`src/lib/web-client/types.ts`
  - `GalleryItem.url: string | null`，增加 availability/removedAt。
- `src/components/gallery/gallery-tile.tsx`、相关 dialog/state/i18n/CSS
  - 不可用收藏显示墓碑，不创建 broken `<img>`，禁用预览/下载，保留取消收藏与来源入口。

### DoD

- 外部删文件后，image 变 `storage_missing`，favorite 行不变。
- Gallery 可见缺失收藏并明确原因。
- 用户取消收藏、单图删除和 Generation 删除仍按既有显式语义工作。

## 2.4 Phase 2：Storage Root 所有权和媒体级 cleanup

### 协议

marker：`LOCAL_STORAGE_DIR/.open-image-storage.json`

```json
{
  "version": 1,
  "databasePathHash": "sha256-hex"
}
```

- 通过 `wx` 原子创建，内容严格解析、字段定长。
- hash 来自 canonical database path；日志只记录 hash 的短前缀，不记录真实路径。
- marker 缺失时，仅在 root 无正式媒体，或正式媒体集合与当前 DB live image/video refs 精确一致时认领。
- marker mismatch/invalid 时，读取诊断可继续，但 write、explicit delete、retention/orphan cleanup 默认拒绝；返回安全 `STORAGE_OWNERSHIP_MISMATCH`。
- cleanup 另使用 `.cleanup.lock`；同一 root 已有活锁时本轮跳过。stale lock 仅在进程不存在且超过上限时回收，并记录事件。

### 改动

- `src/lib/db/client.ts`：公开安全的 canonical database path/hash helper，不输出绝对路径。
- `src/lib/storage/ownership.ts`（新增）：marker claim/verify、lock acquire/release、内部文件识别。
- `src/lib/storage/index.ts`：受管 read/write/delete 前接入 ownership guard；错误文案不含路径。
- `src/lib/db/queries/videos.ts`：增加 live video storage paths 查询。
- `src/lib/db/queries/images.ts` 或新 `src/lib/db/queries/media.ts`：统一 live media refs；不构造过度通用 repository。
- `src/lib/storage/cleanup.ts`：所有权→锁→候选→删除；reference set 包含 images/videos/staging，排除 marker/lock。
- `tests/helpers/integration.ts`：提供成对创建/恢复 DB + storage env 的单一 helper；旧独立 helper 保持兼容但新增测试禁止错配。

### DoD

- 不同 DB 指向同一 root 时，第二个实例无法读写/清理该 root，并产生日志。
- 相同 DB/root 的服务重启可继续使用；两个 cleanup 不重叠。
- MP4、图片、durable staging、marker、活锁不被 orphan 扫描误删。

## 2.5 Phase 3：本地结构化日志与审计

### 事件入口

扩展 `src/lib/observability/safe-logger.ts` 为统一 allowlist emitter，保留 `logApiFailure()` 兼容。新增 `src/lib/observability/local-log-sink.ts`，默认目录 `APP_LOG_DIR=./data/logs`，JSON Lines UTF-8。

固定边界：

- 单条记录 ≤ 4 KiB；字符串逐字段定长。
- 当前文件最大 5 MiB，保留 3 个轮转文件；轮转失败回退 stderr。
- 不接受任意对象、raw Error 或自由文本 details。
- file sink 故障不能递归记录到自身。

最小事件集：

| event | level | 安全字段 |
|---|---|---|
| `storage.ownership_claimed` | info | ownerHashPrefix、adoptedFiles |
| `storage.ownership_refused` | error | expected/actual hash prefix、reason |
| `storage.cleanup_started/completed` | info | runId、candidate/ref counts、结果计数 |
| `storage.cleanup_skipped` | warn | runId、lock/ownership reason |
| `storage.file_removed` | info | runId、mediaKind、entityId、reason、pathHash |
| `storage.file_remove_failed` | error | runId、entityId、safe code |
| `storage.missing_detected` | warn | imageId、wasFavorite、requestId（若有） |
| `storage.recovery_attempted/completed` | info | entityId、provider、method、outcome |
| `worker.tick_failed` | error | safe code；不含 raw message/stack |

### DoD

- 重启后仍可从本地 JSONL 确认 cleanup run、所有权与删除 outcome。
- canary Prompt/key/URL/path/error 永远不出现在 console 或文件日志。
- 日志轮转有界，日志目录不进入媒体 orphan 扫描。

## 2.6 Phase 4：事故元数据恢复与可选字节恢复

### 安全顺序

1. 停止破坏性维护操作，复制当前 `app.db`、`-wal`、`-shm`、`data/images` 和迁移备份。
2. 完成 Phase 1–3 并通过测试。
3. 从 `data/app.db.pre-migrate-v4-to-v5.bak` 只读提取三条 favorite；事务内 `INSERT OR IGNORE`，要求 current image ID 存在且为 `storage_missing`。
4. Gallery 验证三条收藏墓碑可见。
5. 对 9 个 Fal handle 与 1 个 Qwen handle执行只读 poll；只有返回既有结果时才重新经过安全下载、magic/size、ownership 和 guarded restore。
6. 不调用 submit；链接过期/结果不可取只记录 outcome，不覆盖原 tombstone。

### Guarded restore

新增 DB 操作只允许：

```text
storage_missing + storage_path IS NULL
  → 文件已安全落盘
  → 同一短事务恢复 storage_path，清空 removed_at/removal_reason
```

任一并发删除/状态变化获胜时，删除刚下载的未提交文件并记录恢复冲突。

### DoD

- 三条收藏元数据恢复，不伪造字节可用性。
- Provider handle recovery 不产生新 generation/job、不重复计费、不记录临时 URL。
- 可恢复图片重新变 available；失败图片继续保持可解释 tombstone。

## 2.7 改动面

| 目录 | 新增 | 修改 |
|---|---|---|
| `src/lib/observability/` | local log sink + tests | safe logger/event schemas |
| `src/lib/storage/` | ownership + tests | index/cleanup/retention tests |
| `src/lib/db/` | 可选 media query | client、images、videos、tests |
| `src/lib/library/` | — | favorites/types/tests |
| `src/lib/web-client/` | — | GalleryItem contract/tests |
| `src/components/gallery/` | — | tombstone tile/state/tests/styles |
| `src/app/api/images/` | — | request correlation/audit context |
| `tests/helpers/` | paired runtime helper | integration schema/helpers |
| `tests/contract|integration|smoke` | ownership/log/recovery cases | existing image/gallery cases |
| `scripts/` | one-off guarded recovery script（如实施时仍需要） | — |
| `docs/mvp/*`、`.env.example` | — | ownership/logging/收藏墓碑配置说明 |

不需要 schema v6：favorites 已可引用 tombstone；ownership 使用文件 marker；日志使用 JSONL。若实施勘测发现必须持久化新业务状态，必须停下重新讨论迁移，而不是顺手加表。

## 2.8 风险与回滚

| 风险 | 防御 | 回滚 |
|---|---|---|
| marker 误拒绝合法搬迁 | fail closed、日志、显式认领流程 | 移除新 guard 代码；保留 marker 不影响旧代码 |
| marker 被并发创建 | `wx` + 创建后复读验证 | 不匹配者停止，不覆盖 winner |
| 日志写满磁盘 | 5 MiB × 4 有界轮转 | 设置 `APP_LOG_DIR` 或关闭 file sink；stderr 保留 |
| Gallery nullable URL 漏改 | strict TypeScript + contract/component/browser | 同一纵切回滚 DTO/UI |
| 恢复旧 favorite 后再次丢失 | Phase 1 先上线，恢复脚本 guarded | 从实施前备份恢复 DB |
| Provider poll 被误当 submit | adapter spy/contract + script allowlist | 停止恢复；不改变 tombstone |
| ownership guard 阻断真实生成 | startup/health diagnostic 明确，不猜测路径 | 修正显式路径并重启，禁止自动覆盖 marker |

## 2.9 实施批次建议

1. `fix(library): preserve missing image favorites`
2. `fix(storage): bind cleanup to its database owner`
3. `feat(observability): persist bounded storage audit logs`
4. `fix(recovery): restore favorite intent and recover provider results`

每批保持可构建、测试通过，不把恢复数据库操作与未完成的语义修复混在一起。

## 2.10 不在本批

远程日志平台、云备份、媒体 BLOB、跨设备同步、全盘扫描、回收站、App 宿主路径选型、分布式锁/队列、自动付费重生成、无 handle Provider 的猜测式恢复均不实施。
