# 2. 优化方案与改动面

> 本文是后续独立实施会话的执行契约。规划会话不据此修改生产代码。

## 2.1 方案总览

```text
Provider result
  ├─ inline supported without lifecycle regression
  │    └─ bounded Base64 response → staging → local file
  └─ URL-only / async queue contract
       └─ immediate safe download → local file
                          ↓
                 images availability
       ┌──────────────────┼───────────────────┐
       │                  │                   │
    available     retention_expired       user_deleted
 storage_path       storage_path=NULL      storage_path=NULL
       │                  │                   │
   view/download      history placeholder   history placeholder
       │
 external file copy (does not mutate retention state)
```

`storage_missing` 是异常诊断状态：DB 仍标记 available、但读取时发现文件不存在时，原子转为该 tombstone；它不能被伪装成正常过期。

## 2.2 设计决策

| ID | 选择 | 理由 | 放弃项与代价 |
|---|---|---|---|
| D1 | 上游 URL 生命周期与本地保留期解耦 | 前者是 ingestion deadline，后者是产品策略 | 不直接展示远端 URL；始终承担一次本地写入 |
| D2 | 仅在不改变任务生命周期时内联优先 | 减少网络故障，同时保护 durable queue/poll/restart recovery | fal 不切 `sync_mode=true`，仍需 URL 下载 |
| D3 | 豆包请求 `b64_json`，ZenMux 保持双解析；都保留 URL fallback | 官方/现有解析支持，改动局部可逆 | Base64 约 33% 传输开销，继续受 36 MiB/25 MiB 上限约束 |
| D4 | 图片字节留在文件系统，SQLite 保存元数据和墓碑 | 符合当前本机单用户架构，DB 轻量、备份边界清晰 | DB 文件不能单独恢复全部图片资产 |
| D5 | schema v4 让 `storage_path` nullable，新增 `removed_at/removal_reason` | 保留图片历史身份并准确解释不可用原因 | SQLite 需重建 images 表；DTO/UI 都要理解新状态 |
| D6 | availability 从字段不变量派生，不另存重复状态列 | 避免 `status` 与 path/reason 漂移 | query/mapper 必须集中实现派生函数 |
| D7 | `removal_reason ∈ {retention_expired,user_deleted,storage_missing}` | 三种原因均有当前真实需求，文案/排查不同 | 不加入回收站、迁移丢失等想象状态 |
| D8 | 默认 7 天；从 `created_at` 计算；下载/浏览不续期 | 规则可预测、无隐式写入、磁盘增长有界 | 取消收藏一张老图后可能在下一轮立即清理，UI 必须说明 |
| D9 | 收藏只允许 available 图片；cleanup 使用 DB 原子 guard | 收藏是长期保留信号，必须赢过并发 cleanup | tombstone 无法重新收藏；需要重新生成或使用外部导出副本 |
| D10 | 单图主动删除与取消收藏、Generation 整条删除分离；Image DELETE 幂等并留下 `user_deleted` | 满足图片级“永久保留直到主动删除”，历史仍可解释 | 另有 Generation DELETE 会硬删除整个聚合，必须使用不同 API/文案 |
| D11 | 下载是只读响应，不记录 `downloaded_at` | 本机单用户无审计需求；不污染 retention 模型 | 应用无法展示下载历史，符合本批边界 |
| D12 | 当前不建通用代理层；未来 App 由宿主 transport 复用系统网络栈 | 遵循 KISS/YAGNI，避免把产品变成代理管理器 | 当前 Node 与浏览器代理仍可能不同，保留 improve-2 窄配置 |

### 2.2.1 数据不变量

| 派生状态 | `storage_path` | `removed_at` | `removal_reason` | Favorite |
|---|---|---|---|---|
| `available` | 非 NULL | NULL | NULL | 可有可无 |
| `retention_expired` | NULL | 非 NULL | `retention_expired` | 不得存在 |
| `user_deleted` | NULL | 非 NULL | `user_deleted` | 不得存在 |
| `storage_missing` | NULL | 非 NULL | `storage_missing` | 若读取时发现 favorite 文件缺失，删除坏 favorite 后转墓碑并记录安全诊断 |

迁移和写路径必须拒绝半状态：只有 path 或只有 reason/removed_at。可以由 SQLite `CHECK` 约束表达：available 三字段组合，或 removed 三字段组合；`removal_reason` 只允许上述三值。

## 2.3 分阶段实施

### P1：Provider 内联优先

**目标**：在不改变 Job 生命周期的情况下减少可避免的远端图片下载。

**改动**：

- `src/lib/providers/adapters/doubao.ts`
  - `buildRequestBody()` 将 `response_format` 从 `url` 改为 `b64_json`。
  - `RESERVED_KEYS` 继续阻止调用方用 providerOptions 覆盖该安全默认。
  - `parseImages()` 保留 `b64_json` 与 `url` 双解析；无结果仍使用现有安全错误。
- `src/lib/providers/adapters/zenmux.ts`
  - 保持 Base64/URL 双解析和现有同步三分钟 timeout；只补足明确的 contract tests/文档，不为了“统一”加入多余配置。
- `src/lib/providers/http-client.ts`、`src/lib/storage/index.ts`
  - 不提高 36 MiB inline JSON、25 MiB decoded image、PNG/JPEG/WebP allowlist；若测试暴露真实单图超限，再单独评估。
- fal/SiliconFlow/Zhipu/Qwen/Kling adapters 不修改返回模式，只补矩阵测试防止误切生命周期。

**DoD**：豆包 request body 明确为 `b64_json`；Base64 可完整落盘且 raw payload 不进 SQLite；URL fallback 仍可转存；fal queue/poll、其他 URL-only adapters 的请求契约没有变化。

### P2：schema v4 与图片墓碑

**目标**：让图片文件生命周期与生成历史生命周期解耦。

**schema 目标**：

```sql
images(
  id TEXT PRIMARY KEY,
  generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  "index" INTEGER NOT NULL,
  storage_path TEXT,
  content_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  removal_reason TEXT,
  CHECK (
    (storage_path IS NOT NULL AND removed_at IS NULL AND removal_reason IS NULL)
    OR
    (storage_path IS NULL AND removed_at IS NOT NULL AND
      removal_reason IN ('retention_expired', 'user_deleted', 'storage_missing'))
  )
)
```

**迁移改动**：

- `src/lib/db/schema.ts`：nullable path + tombstone fields/check，保持 `(generation_job_id,index)` unique 和 job cascade。
- `src/lib/db/schema-manifest.json`：升级到 v4，列出新列与现有 indexes。
- `scripts/migrate-db.mjs`
  - 在现有 version map 中增加 `3 → 4`。
  - transaction 内创建 `images_v4`、复制所有 v3 image 行为 available、复制/保持 favorites 引用、替换表并重建 indexes。
  - 不修改 Generation/Job/Prompt/error 数据。
  - 沿用自动 `.pre-migrate-v3-to-v4.bak`、integrity/schema/FK 检查；迁移失败时 transaction 回滚。
- `tests/helpers/db-schema.ts` 与所有显式 fixture schema 同步，禁止测试 schema 漂移。

**query/read model 改动**：

- `src/lib/db/queries/images.ts`
  - 新增集中式 availability 派生类型/mapper。
  - `listStoragePaths()` 只返回 non-null live paths。
  - 用原子 `markImageRemovedIfUnfavorited(id, reason, removedAt)` 替代 retention 的物理 delete。
  - 主动删除事务中先移除 favorite，再将 available 图片标成 `user_deleted`；已是 tombstone 时幂等成功。
- `src/lib/job-engine/types.ts` 与 `src/lib/web-client/types.ts`：
  - `ImageView.url: string | null`；
  - 增加 `availability: 'available' | 'retention_expired' | 'user_deleted' | 'storage_missing'`；
  - 增加 `removedAt: string | null`；不向 UI 暴露本地 storage path。
- `src/lib/job-engine/orchestrator.ts`、`src/lib/library/history.ts`：映射全部 image 行；tombstone 的 URL 为 null，历史图片计数包含 tombstone，避免完成记录退化为 0。
- `src/lib/library/summaries.ts`：`imageCount` 继续表示历史生成图片总数（包含 tombstone），但 `coverImageUrl` 必须只从 available 图片选取；没有 available 图片时为 null。
- Gallery/Favorites query 只返回 available + non-null path；遇到破损历史 favorite 必须安全跳过/修复，而不是构造坏 URL。
- P2 同一纵切必须修改所有 TypeScript/UI 消费者，使 nullable URL 与 availability 至少能安全渲染正确占位；不得把“schema/DTO 已变、页面仍无条件渲染 `<img>`”作为独立提交。P4 负责完整操作体验、文案打磨和回归，不承担首次兼容修复。

**DoD**：v3 数据无损迁移为 available；Generation/History 能同时返回 available 与 tombstone；schema/invariants/FK/unique index 通过；没有 Base64/BLOB 写入 DB。

### P3：7 天清理、读取/下载/删除 API

**目标**：落实统一、可配置、并发安全的生命周期和用户动作。

**保留期 policy**：

- 新增最小单职责解析器（建议 `src/lib/storage/retention-policy.ts`）：
  - 默认 `IMAGE_RETENTION_DAYS=7`；
  - `0` 禁用自动清理；
  - 正整数表示天数；建议接受上限 36500（100 年），非法/负数/小数/超限回退 7；
  - 启动/首次使用时对非法配置记录一次安全 warning，不记录路径或敏感数据。
- `.env.example`、README 更新默认值和含义。
- cutoff 只使用 `images.created_at`；取消收藏不重置时间。

**cleanup**：

- `src/lib/storage/cleanup.ts`
  - retention candidates 只包含 `available` 且未收藏图片。
  - 在 DB 原子条件更新中把图片标为 `retention_expired` 并取回原 storage path；并发 favorite 先成功时更新必须为 0。
  - tombstone 提交后删除文件；删除失败产生 failure，由现有 orphan cleanup 稍后清理，API 已不再暴露该文件。
  - `dryRun` 只统计候选，不写墓碑/删文件。
  - cleanup 结果命名从 `deletedImages` 调整为能区分 `expiredImages/deletedFiles/failures` 的安全统计（具体 shape 保持内部，不新增公网 API）。
- worker 首 tick + 默认每小时行为保持，不创建第二个 scheduler。

**图片读取与缺失协调**：

- `GET /api/images/:id`
  - available 且文件存在：`200` + 内容流；
  - tombstone：structured `410`，code 为 `IMAGE_EXPIRED`、`IMAGE_DELETED` 或 `IMAGE_MISSING`；
  - 完全不存在的 ID：`404`；
  - DB available 但文件不存在：原子标记 `storage_missing`（favorite 需要同步移除），返回 `410 IMAGE_MISSING`，记录安全诊断，不泄漏绝对路径。
- API error handler 增加专用 Gone/availability error，不用通用 404/500 淹没根因。

**下载**：

- 新增 `GET /api/images/:id/download`，复用同一 availability/read-stream policy；不要通过内部 HTTP 再请求 `/api/images/:id`。
- 成功返回 `Content-Type`、`Content-Length`（若可靠）、`Content-Disposition: attachment; filename*=UTF-8''...`。
- 文件名只由受控 provider/model/date/short-id/extension 组成并清理危险字符；不把完整 prompt 放进 header。
- 下载是只读操作，不更新 `created_at`、favorite、removed 字段或任何 `last_accessed_at`。

**主动删除**：

- `DELETE /api/images/:id`：存在 image 时幂等 `204`；available 图片在短事务中删除 favorite 并标 `user_deleted`，事务后删除文件；再次删除同一 tombstone 仍为 `204`；未知 ID 为 `404`。
- UI 对 available 图片提供“下载”和“删除”；删除使用明确二次确认。取消收藏仍只调用 Favorites API，不暗中删除。

**DoD**：7 天/0/非法配置语义正确；收藏与 cleanup 竞态不误删；下载不续期；DELETE 与 cleanup 都只删字节、保留可解释墓碑；缺失文件不冒充正常过期。

### P4：UI、文档、回归与受控验收

**目标**：让用户看见正确状态，并将实现事实回写到权威文档。

**UI/read model**：

- Generation Stage、Generation Detail、History：
  - available 显示缩略图/预览、收藏、下载、删除；
  - `retention_expired` 显示“图片已过期清理”；
  - `user_deleted` 显示“图片已删除”；
  - `storage_missing` 显示“本地图片文件不存在”；
  - tombstone 不能点击预览、收藏或下载。
- 历史的图片数表示“该历史中生成并记录的图片总数”，包括 tombstone；Gallery 只统计/显示仍 available 的收藏图片。
- 首页项目卡片的图片总数同样包含 tombstone，但封面只使用最新 available 图片；全部过期/删除时不渲染破图。
- 在图片操作区或设置说明中显示：“未收藏图片默认保留 7 天；收藏后持续保留。下载不会延长应用内保留期。”
- 中英文 i18n 同步；不得把 retention expiry 显示成 Provider error 或 Job failed。

**权威文档同步**：

- `docs/mvp/db/{data-model,...}.md`：schema v4 与 invariants。
- `docs/mvp/storage/{goals-duty,architecture,dfd-interface,test}.md`：7 天、墓碑、缺失协调。
- `docs/mvp/api/constraints.md`：ImageView availability、410、download/delete。
- `docs/mvp/library/*`：History count/tombstone、Gallery live-only。
- `docs/mvp/providers/*`：内联优先矩阵和 URL-only immediate materialization。
- `docs/mvp/web-client/*`、`docs/mvp/web-ui/*`：nullable URL 与占位交互。
- README、`.env.example`：运行配置和当前 Node/未来 App 网络边界。

**DoD**：所有 04 自动化门禁通过；受控本地浏览器 flow 验证 Base64、URL、过期、收藏、下载、删除和刷新/重启后的历史解释；不要求真实付费 Provider 模拟 7 天，可使用临时 DB/storage 与受控时间。

## 2.4 按目录的改动面

| 路径 | 新增 | 修改 | 删除 | 说明 |
|---|---:|---:|---:|---|
| `src/lib/providers/` | 0 | Doubao/ZenMux tests、必要 contract 注释 | 0 | 内联优先，不改 async 生命周期 |
| `src/lib/db/` | query/type tests | schema、manifest、images queries、exports | 0 | schema v4 与墓碑不变量 |
| `scripts/migrate-db.mjs` | 0 | v3→v4 migration | 0 | 沿用 backup/transaction/FK 机制 |
| `src/lib/storage/` | retention policy + tests | cleanup/index/tests | 0 | 7 天、tombstone、missing reconcile |
| `src/lib/job-engine/` | 0 | ImageView mapper/types/tests | 0 | 不改 submit/poll 状态机 |
| `src/lib/library/` | 0 | History/Favorites/read models/tests | 0 | tombstone 计数、Gallery live-only |
| `src/app/api/images/` | download route | `[id]` GET/DELETE、contracts | 0 | 200/204/404/410 |
| `src/lib/web-client/` | API methods/tests | DTO/types/client | 0 | nullable URL + actions |
| `src/components/`, `src/lib/i18n/` | 必要确认 UI | Generate/History/Dialog/Gallery/messages | 0 | 状态占位与下载/删除 |
| `tests/` | migration/contract/integration cases | helpers/factories | 0 | 遵循 test-blueprint |
| `.env.example`, `README.md`, `docs/mvp/` | 0 | 配置与权威事实 | 0 | 文档一致性 |

最终文件名可随现有目录组织微调，但不得把 storage lifecycle、Provider response preference 和 UI state 混入一个新“万能模块”。

## 2.5 API 与 DTO 契约

### 2.5.1 ImageView

```ts
type ImageAvailability =
  | 'available'
  | 'retention_expired'
  | 'user_deleted'
  | 'storage_missing';

type ImageView = {
  id: string;
  jobId: string;
  index: number;
  url: string | null;
  width: number | null;
  height: number | null;
  favorited: boolean;
  availability: ImageAvailability;
  removedAt: string | null;
};
```

不对浏览器暴露 `storagePath`、绝对路径或 removal 内部异常。`favorited` 对 tombstone 必须为 false。

### 2.5.2 Image HTTP

| Method | Path | available | tombstone | unknown ID |
|---|---|---|---|---|
| GET | `/api/images/:id` | 200 inline stream | 410 typed error | 404 |
| GET | `/api/images/:id/download` | 200 attachment | 410 typed error | 404 |
| DELETE | `/api/images/:id` | 204 + tombstone | 204 idempotent | 404 |

410 structured error code 映射：

- `retention_expired → IMAGE_EXPIRED`
- `user_deleted → IMAGE_DELETED`
- `storage_missing → IMAGE_MISSING`

### 2.5.3 兼容说明

- 新前端与新后端同仓发布；`ImageView.url` 从 string 变 nullable 是明确 breaking DTO 变更，必须同一纵切修改所有消费者。
- 旧数据库 v3 经 prestart/predev 自动迁移到 v4；迁移前产生版本化备份。
- 旧 available image 行全部保持原路径和可读性；不在迁移时扫描文件或把缺失误标过期，missing 在读取/维护时协调。

## 2.6 失败、竞态与补偿

| 场景 | 线性化/防御 | 残余与补偿 |
|---|---|---|
| cleanup 与 favorite 并发 | SQL 条件更新要求不存在 favorite；事务 winner 决定结果 | cleanup 先胜则收藏收到 Gone/Conflict；不复活已清理文件 |
| DELETE 与 favorite 并发 | 同一短事务删除 favorite + 标 user_deleted | 删除是用户显式 destructive 意图，优先于收藏 |
| tombstone 成功、文件删除失败 | API 已不再暴露 path；记录 failure | orphan cleanup 超过 grace 后重试回收 |
| 文件先被外部删除 | 读取时标 storage_missing，清除坏 favorite | 历史保留，用户需重新生成/使用导出副本 |
| DB migration 失败 | pre-migration backup + immediate transaction + FK/schema check | DB 保持 v3；修复后重跑，不手工半迁移 |
| Base64 超限/非法 MIME | 现有 36/25 MiB + MIME/magic 拒绝 | Job STORAGE_ERROR，安全诊断，不回退 URL 重提生成请求 |
| 下载中同时被删除 | 打开文件/状态检查竞态由读取实现收口；不得返回部分成功后改 JSON | 可在成功打开 fd 后完成该次下载，或在开流前返回 410；测试冻结选定语义 |

推荐下载/删除竞态语义：下载成功打开只读文件句柄后允许本次流完成；DELETE 移除目录项并留 tombstone，新下载请求返回 410。这符合 Unix/本机文件语义且避免传输中途人为截断。

## 2.7 风险与回滚

| 风险 | 防御 | 回滚 |
|---|---|---|
| v4 表重建破坏 favorites/FK | backup、事务、copy count、foreign_key_check、migration smoke | 停止服务，恢复版本化 v3 backup 与对应代码 |
| DTO nullable URL 漏改消费者 | TypeScript strict + contract/integration + UI tests | 同一 commit/纵切回退 API 与 UI |
| cleanup 误删收藏 | 原子 NOT EXISTS guard + 并发单测 | 关闭 `IMAGE_RETENTION_DAYS=0`；从备份/外部导出恢复文件 |
| tombstone 表持续增长 | 只保留小元数据；Generation 历史本就要求长期保留 | 未来有真实 DB 体积数据再设计历史保留策略 |
| Base64 内存/响应放大 | 保持 36 MiB/25 MiB 上限，不增加 multi-image 预算 | 豆包恢复 URL request；ZenMux URL fallback 仍可解析 |
| current Node 仍不继承显式代理 | 内联减少依赖、URL-only 保留 improve-2 窄配置 | 使用 direct/TUN 或明确可信 host；App 宿主选型后替换 transport |
| 7 天令用户意外 | UI 明示、收藏永久、可配置更长/0 | 配置更长时间并重启；不需要 schema 回滚 |

## 2.8 实施与提交建议

用户已要求后续分批提交。建议每个 commit 保持可构建、可迁移或由同一纵切完整覆盖：

1. `provider: prefer inline image responses where supported`（P1）
2. `storage: preserve image tombstones across retention cleanup`（P2 + 必要 consumer compatibility/P3 backend，避免中间 DTO/schema 不可运行）
3. `api: add image download and explicit deletion`（P3 actions）
4. `ui: surface image availability and retention actions`（P4 UI/docs）

具体 commit 边界可在实施时按测试耦合合并 P2/P3，但不得提交“schema 已 nullable、消费者仍假设 string”这类不可运行中间态，也不得混入当前无关工作树文件。

## 2.9 与 00 的边界对齐

- 默认 7 天、可配置更长、0 禁用自动清理：P3。
- 收藏持续保留，主动删除退出：P2/P3。
- 下载外部副本且不续期：P3。
- 历史、任务、提示词、Provider 错误保留，过期有明确占位：P2/P4。
- Base64 能用则用，URL-only 立即转存：P1。
- 不建设庞大代理层，未来 App 复用系统网络栈：D12 与本批 out-of-scope。

### 2.9.1 01 问题追溯

| 01 问题 | 02 回应 | 04 验收 |
|---|---|---|
| P-01 Provider URL 转存易受网络环境影响 | P1、D1～D3 | INL、NET |
| P-02 豆包可解析 Base64 却主动请求 URL | P1 豆包 `b64_json` | INL-01～05 |
| P-03 cleanup 删除历史身份 | P2/P3、D5～D7 | MIG、DB、CLN、UI-05/06 |
| P-04 schema/DTO 假设文件永存 | P2 ImageView/availability | DB、IMG、UI-01～04 |
| P-05 retention 默认与解析不符合产品规则 | P3 retention policy | RET |
| P-06 缺少下载和主动删除 | P3 Image HTTP/API | DEL、DLD、UI-07 |
| P-07 浏览器与 Node 网络边界不同 | D12、保持 improve-2 窄兼容 | NET-01～04 |
| P-08 History/首页计数与封面依赖现存行 | P2/P4 read models | DB-03/06、UI-05/06/10 |

## 2.10 不在本批

通用代理探测/自动端口选择、App 宿主选型、原生保存对话框、回收站、云同步、下载审计、访问续期、缩略图派生缓存、磁盘配额/全盘扫描、按 Provider retention、远端 URL lazy loading、图片 BLOB 入库、全 Provider SDK 迁移均不实施。用户主动的 Generation 聚合硬删除由 [独立 improve-1](../../2026-07-20-provider-wait-and-history-delete/improve-1/README.md) 实施，不与本批自动 retention/单图 DELETE 合并。
