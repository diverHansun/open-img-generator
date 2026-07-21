# 1. 问题基线与当前实施状态

> 时间口径：2026-07-21，分支 `mvp`，代码基线 `137d725`。本文描述事故后的真实状态，不把 02 的目标态写成已完成。

## 1.1 事故证据

| 证据 | 当前事实 | 结论 |
|---|---|---|
| `data/app.db` | 36 generations、50 jobs、30 images、0 favorites | 不是数据库整体重置。 |
| images availability | 9 available、21 `storage_missing` | 生成历史仍在，旧图片字节不在当前 root。 |
| `data/images` | 9 个正式文件，均对应本轮 15:22–15:28 的新结果 | 当前新链路可落盘，但旧 21 文件已消失。 |
| `app.db.pre-migrate-v4-to-v5.bak` | 21 images、3 favorites、完整相对 storage path | 三条收藏真实存在；v5 迁移前元数据未丢。 |
| missing 时间 | 2026-07-21 16:13:00–16:13:09 | 页面读取在该窗口发现缺失并协调状态；不是文件实际删除时间。 |
| removal reason | 21 条全为 `storage_missing`，0 条 `retention_expired` | 默认 7 天 retention 不是本次原因。 |

磁盘搜索未在项目目录、用户目录及相关临时目录找到三张收藏图片的精确文件名。SQLite 只保存元数据，不能单独恢复图片字节。

## 1.2 核心问题

| ID | 当前问题 | 用户影响 | 严重性 |
|---|---|---|---|
| P-01 | `markImageStorageMissing()` 删除 favorite | 一次外部文件缺失永久抹掉用户收藏意图，Gallery 变空 | 高 |
| P-02 | `listFavorites()` 只返回 `storage_path IS NOT NULL` | 即使保留 favorite，Gallery 也无法解释缺失收藏 | 高 |
| P-03 | cleanup 用当前 DB 的 image paths 判断整个 root 的 orphan，未验证 DB/root 所有权 | 临时 DB 或第二实例可能删除真实实例文件 | 高 |
| P-04 | orphan 引用集合不含 `videos.storage_path` | Seedance MP4 超过 grace 后会被当成 orphan | 高 |
| P-05 | 现有日志只覆盖 API failure，文件删除没有持久审计 | 无法证明哪个进程、何时、为何删除文件 | 高 |
| P-06 | DB/storage 路径均可独立由环境变量改变，测试辅助只靠调用者自觉成对使用 | 配置漂移没有 fail-fast 边界 | 中 |
| P-07 | successful job 会清空 `result_snapshot`；sync Provider 没有 handle | 文件消失后可恢复性有限 | 中 |

## 1.3 数据流与隐式副作用

当前读取路径：

```text
GET /api/images/:id
  → openReadableImage()
  → getReadStream(storage_path)
  → 文件不存在 / NotFoundError
  → markImageStorageMissing()
      ├─ DELETE favorites WHERE image_id = ?
      └─ UPDATE images SET storage_path=NULL, removal_reason='storage_missing'
  → 410 IMAGE_MISSING
```

代码锚点：

- `src/lib/library/images.ts::openReadableImage`
- `src/lib/db/queries/images.ts::markImageStorageMissing`
- `src/lib/library/favorites.ts::listFavorites`
- `src/components/gallery/gallery-tile.tsx::GalleryTile`

“缺失协调”本身是幂等诊断写入，可以保留；错误在于它跨越职责边界删除 favorite。Image availability 是文件事实，Favorite 是用户意图，两者不应由一次读取失败强耦合。

## 1.4 cleanup 架构现状

`src/lib/storage/cleanup.ts::cleanupStoredImages` 当前：

1. 从传入 DB 查询 retention candidates；
2. 删除过期未收藏图片的字节；
3. 只用 `images.storage_path` 与 staging snapshots 构造 referenced set；
4. 遍历 `LOCAL_STORAGE_DIR`，超过 1 小时且不在 referenced set 的文件直接 `rmSync`。

关键缺口：

- 传入 `DbClient` 避免误用全局 DB，只解决进程内测试耦合，没有证明该 DB 拥有当前 storage root。
- cleanup 可由每个 worker 首次 tick 立即运行；两个进程若配置不同 DB、相同 root，会各自以局部事实删除对方文件。
- `videos` 已进入 schema v5 和同一 storage 实现，但 orphan 引用仍只读取 images。
- 没有 cleanup run ID、候选数、所有权、删除 outcome 或 actor 的持久日志。

代码锚点：

- `src/lib/storage/cleanup.ts::cleanupStoredImages`
- `src/lib/job-engine/worker.ts::startWorker`
- `src/lib/db/queries/images.ts::listStoragePaths`
- `src/lib/db/queries/videos.ts`
- `src/lib/storage/index.ts::downloadAndStoreVideo`

## 1.5 日志现状

`src/lib/observability/safe-logger.ts` 已有正确的脱敏方向：固定 event、code、status 和受限 requestId，并主动丢弃 raw error。但当前只有 `api.request_failed`，输出到 stderr，不持久化。

其他模块仍使用自由文本 `console.error/console.warn`，例如 worker tick failure、credential fallback 和 retention 配置 warning。文件删除/孤儿扫描没有日志。由此导致：数据库只能记录“何时被读取发现缺失”，不能记录“谁先删除了文件”。

新增日志不应另起复杂平台，而应把现有 safe logger 扩成固定 schema 的单一入口，并增加一个有界本地 sink。

## 1.6 数据模型与 API gap

- `favorites(image_id UNIQUE)` 可以合法引用 tombstone image；schema 无需新增 favorite 状态。
- `GalleryItem.url` 当前是必填 string，缺少 availability/removedAt；见 `src/lib/library/types.ts` 与 `src/lib/web-client/types.ts`。
- Gallery query 强制 `isNotNull(images.storagePath)`，因此无法显示 missing favorite。
- `GalleryTile` 无条件创建可点击 `<img src={item.url}>`；只能靠 `onError` 显示通用 broken-image 状态。
- `markImageUserDeleted` 显式删除 favorite 是正确语义；本批不得误改。

最小数据模型修正是复用现有 favorite + image tombstone：不增加新表或 `favorite_status`，只让 Gallery DTO 接受 nullable URL 和 availability。

## 1.7 恢复能力现状

缺失图片按 Provider：

| Provider | 缺失数 | 有既有 Provider handle |
|---|---:|---:|
| Fal | 9 | 9 |
| Qwen | 2 | 1 |
| ZenMux | 8 | 0 |
| Zhipu | 2 | 0 |

所有缺失 job 的 `result_snapshot` 已清空。Fal 及一个 Qwen handle 可以做 best-effort 只读 poll；不得重新 submit。ZenMux、Zhipu 与无 handle Qwen 只能依靠磁盘备份、上游任务历史或重新生成。

## 1.8 文档与实现冲突

| 文档 | 文档说法 | 当前实现/事故 | 处理 |
|---|---|---|---|
| improve-3 `00` | 收藏持续保留直到用户主动删除 | missing read 删除 favorite | 以 improve-4 supersede missing 条款 |
| improve-3 `02` | favorite 文件缺失时清除坏 favorite | 已证明会抹掉用户意图 | 废止该条款 |
| improve-3 `04 IMG-05` | missing 协调清除 favorite | 错误测试把缺陷冻结成契约 | 改为保留 favorite + Gallery tombstone |
| `docs/mvp/storage/architecture.md` | cleanup 不删除收藏 | missing read 路径仍会删 | 实施后补齐“异常缺失也保留” |
| `docs/test-blueprint.md` | DB/storage 必须临时隔离 | 生产代码没有所有权 fail-fast | 增加运行时护栏，不只依赖测试纪律 |

## 1.9 SWE 与架构审视

- **信息隐藏/低耦合（SWE 02）**：文件存在性与收藏意图被错误耦合；应通过独立字段/关系表达各自事实。
- **正确性优先（SWE 00）**：宁可停止自动清理并留下 orphan，也不能在所有权不确定时误删用户文件。
- **KISS/YAGNI（SWE 03/05）**：本机 marker + lock + JSONL 已足够；不引入分布式协调或日志平台。
- **依赖与质量属性（架构框架）**：所有权 marker 是可逆的本地协议；删除用户文件是不可逆动作，必须 fail closed 并留痕。
- **测试是设计探针（SWE 07）**：原 IMG-05 测试准确执行了错误需求，说明测试需要先校正业务不变量，而不是只增加覆盖率。
