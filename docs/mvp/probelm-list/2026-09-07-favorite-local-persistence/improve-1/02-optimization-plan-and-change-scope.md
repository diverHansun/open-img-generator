# 2. 优化方案与改动面

> 交给后续开发会话。本规划会话不实施。基线 `main@22a757c`。

## 2.1 方案总览

在**收藏切点**把 live `remote` 钉成 `managed`，复用现有 `downloadAndStore` 与 `images_availability_check`。未收藏 URL 图继续 302。旧收藏不自动下载：仍持有 URL 时由用户点「保存到本地」补钉，墓碑只保留失效记录。Web 设置显示逻辑相对路径 `images/`；桌面打开实际目录。

```text
点收藏
  │
  ├─ 已是 managed 且文件在 → insert favorites（与现在相同）
  ├─ live remote
  │     ├─ Stage 1: 后端 downloadAndStore(remoteUrl)
  │     │              成功 → promote 为 managed → insert favorites
  │     │              失败 → 不写 favorites → StorageError / 410
  │     └─ Stage 2: 若失败且仍值得试
  │                    浏览器取到字节 → POST pin（同一套魔数/大小校验）
  │                    仍失败 → 回滚红心 + 「这张已经存不了了」
  └─ 已是墓碑 / URL 已死 → 新收藏 410，不写 favorites

旧收藏的「保存到本地」只允许 live remote 行；`remote_expired` 墓碑没有 URL，因此保留红心并显示「原图已删除或丢失」，不显示无效操作。
```

不新增 schema 列，不新建收藏根目录，不新造错误类型。

## 2.2 设计决策表

| 决策项 | 选择 | 理由 | 放弃的选项 | 代价 |
|--------|------|------|------------|------|
| 钉盘时机 | 收藏时；旧收藏仅用户主动补钉 | 00 成功标准约束新收藏；生成仍可在 Node 下不了 CDN 时成功；不让页面读取产生网络写入 | 生成后后台钉全部 remote；cleanup/Gallery 自动补钉 | 未收藏图与未主动补钉的旧图仍可能过期 |
| 存储位置 | 现有 `getStorageRoot()` | 已有校验、所有权、cleanup | 用户自选收藏夹当权威 | 文件名仍是 UUID |
| 成功定义 | 字节已写入且行已是 managed，再写 favorites | 禁止假红心 | 先红心再后台重试 | 代理环境下收藏可能变慢 |
| 失败 | 不插入 favorite；乐观 UI 回滚 | 与成功定义一致 | 保留红心并标「待保存」 | 用户需在链接仍活时重试 |
| 取消收藏 | 只删 favorite 行，文件仍 managed | KISS；避免「取消=删文件」再丢图 | 移出收藏夹/删文件 | 磁盘占用不立刻下降 |
| 自动浏览器下载 | 收藏时**停止** `triggerImageDownload` | 那是系统下载目录，救不了应用内展示 | 继续顺带下载 | 用户若只想要一份下载件需点下载 icon |
| 错误模型 | 补 `classifyApiError(StorageError)`；UI 映射已有 code | 00 要求字段做对且不过度设计 | `FavoritePinError`、`pin_status` 列 | 前端要读 `error.code` / `details.category` |
| 浏览器回传 | Stage 2 尽力而为，CORS 失败则诚实认输 | 用户主用 Web，且 07-21 的根因是 Node 网络栈 | 当作一定成功；或做代理系统 | 部分 CDN 无 CORS 时 Stage 2 无效 |
| 设置 | Web 显示逻辑路径 `images/`；桌面 `shell.openPath(storageRoot)` | 可移植且不泄露服务器结构 | 导出可读文件名；打开整个数据根当收藏夹 | Web 不展示自定义物理目录 |
| 存量收藏 | 用户点「保存到本地」才补钉；无 URL 的墓碑保留红心和失效状态 | 避免 Gallery/cleanup 隐式下载；不静默删除历史 | 一次性强制迁移脚本 | 用户需要主动救回仍可访问的图 |
| 交互反馈 | 工作区全局顶部提示队列，统一 3 秒；按钮 pending 到两条保存路径结束 | 三个收藏入口语义一致 | 页面各自 error 布尔值 | 增加小型共享前端状态 |

## 2.3 分阶段实施

两阶段仍属 improve-1。

### Stage 1 — 后端钉盘、诚实错误、设置路径

**目标：** 在 Node 能拉到 CDN 的环境里，新收藏一定变成应用内可预览的 managed 图；失败无红心；Web 能看见存储路径；桌面能打开该目录。

**改动文件（包级，承重）**

- `src/lib/db/queries/images.ts`：新增 `promoteRemoteImageToManaged(id, stored, client)`，`WHERE source_kind='remote' AND remote_url IS NOT NULL AND removed_at IS NULL`。不要复用 `restoreImageStorageIfMissing`（它只吃 `storage_missing`）。
- `src/lib/library/favorites.ts`：`addFavorite` 改为 `async`。live remote 先 `downloadAndStore(remoteUrl)` 再 promote 再 insert；已 managed 保持原同步 insert 语义。promote 与 insert 放在同一 immediate transaction 的**写库部分**（下载在事务外，避免长事务锁库）。
- `src/lib/library/images.ts` 或 favorites 旁的小函数：`pinRemoteImage(imageId)` 供新收藏与用户触发的旧收藏补钉共用；若条件更新失败，必须删除刚写入的文件，避免孤儿文件。
- `src/lib/storage/cleanup.ts`：不参与补钉；remote 到期仍写墓碑并保留 favorite 关系。孤儿清理继续作为下载/晋升竞态的最后防线。
- `src/app/api/error-handler.ts`：`StorageError` → `code: 'STORAGE_ERROR'`，`retryable` 用 `err.retryable`，`details` 只放已有 diagnostic（`category`，可选 `hostname`）。禁止新枚举。
- `src/app/api/favorites/route.ts`：await 钉盘；`structured: true` 已具备。
- `src/components/generate/generate-stage.tsx`、`src/components/dialogs/generation-detail-dialog.tsx`、`src/components/gallery/gallery-screen.tsx`：收藏成功前不要 `triggerImageDownload`；按 code 选文案。Gallery 的 live remote 旧收藏提供用户触发的「保存到本地」，墓碑显示「原图已删除或丢失」。
- `src/components/shell/`：新增可复用工作区顶部提示队列，从上向下堆叠、统一 3 秒、含无障碍播报；三个收藏入口只发布状态，不各自维护错误文案。
- `src/lib/i18n/messages/{generate,gallery,dialogs,common}.ts`：不可恢复 → 「原图已删除或丢失」；可重试 STORAGE_ERROR → 「未能保存到应用，请检查存储空间或目录权限」。
- `src/app/api/settings/route.ts`、`src/lib/app-settings/types.ts`：响应增加稳定逻辑值 `localData.storageDirectory: 'images/'`，禁止输出 `getStorageRoot()`。
- `src/components/settings/settings-screen.tsx` 与 `src/lib/i18n/messages/settings.ts`：Web 始终展示 `images/`；打开按钮仅桌面启用，文案改为打开图片存储目录。
- `electron/main.ts`：`openDataDirectory`（或等价 IPC）改为 `shell.openPath(storageRoot)`；若目录不存在则先保证创建。`runtimeInfo` 可带上同一路径，避免桌面/Web 两套真相。
- 权威文档同步：`docs/mvp/library/use-case.md` UC4、`docs/mvp/library/goals-duty.md`（收藏命令可调 storage）、`docs/mvp/settings/dfd-interface.md` 与 `use-case.md`（允许返回存储根路径）、07-21 README 收藏语义标注 superseded。

**DoD**

- 对 live remote：收藏成功后 `sourceKind=managed`、文件可读、`GET /api/images/:id` 不再 302。
- 钉盘失败：`favorites` 无新行，UI 无红心，body 含可区分的 `STORAGE_ERROR` 或 `REMOTE_IMAGE_EXPIRED`。
- 已 managed 收藏行为与今天一致（含幂等）。
- Web 设置可见逻辑路径 `images/` 且不含绝对路径；桌面按钮打开实际图片目录而非仅数据根。
- 单测/契约/集成见 04 Stage 1。

### Stage 2 — 浏览器回传字节（Web 主路径兜底）

**目标：** Node 因 Fake-IP / 代理下不了 CDN、但浏览器已经能显示该图时，仍可能收藏成功。

**做法（KISS）**

1. Stage 1 的 `pinRemoteImage` 增加可选 `bytes?: Uint8Array`（或已校验的临时文件路径）。无 bytes = 后端自己 download；有 bytes = 走与 `downloadAndStore` **同一套** 大小/魔数/原子 rename，禁止跳过校验。
2. 新增 `POST /api/images/:id/pin`：只接受 `Content-Type: application/octet-stream` 客户端字节；服务端下载仍只由 `POST /api/favorites` 负责，避免重复的空 body 协议。成功只 promote，不写 favorite（收藏仍走 `POST /api/favorites`，此时行已是 managed，走快路径）。鉴权/本机单用户模型与现有 API 一致。
3. 前端仅在 `STORAGE_ERROR` 且 `retryable === true`，或 `details.category` ∈ `{remote_dns_failed, remote_address_blocked, proxy_mapping_not_trusted, remote_download_failed, remote_download_timeout}` 时尝试：`fetch(/api/images/:id)` 取 blob（可能因 CDN CORS 失败）→ `POST .../pin` → 再 `POST /api/favorites`。CORS / 取字节失败 → 直接「这张图已经存不了了」，不要假装还会后台保存。
4. 不把 pin 做成队列、不写 `pin_attempts`、不做 Service Worker。

**DoD**

- 契约测试：合法 PNG 字节可把 remote promote 为 managed；非法字节（非魔数、过大）不改行。
- 前端：后端失败且 category 可回传时走 Stage 2；CORS 失败落到不可恢复文案。
- 安全：客户端字节必须过现有 SSRF 无关的内容校验；路径仍只能写在 storageRoot 内。不信任客户端声明的 contentType。

## 2.4 按包/目录的改动面

| 包/目录 | 新增 | 修改 | 删除 | 说明 |
|---------|------|------|------|------|
| `src/lib/db/queries/` | `promoteRemoteImageToManaged` | images 查询测试 | 无 | 不改 schema |
| `src/lib/library/` | `pinRemoteImage`（可与 favorites 同文件） | `addFavorite` async | 无 | 依赖 storage，不依赖 job-engine |
| `src/lib/storage/` | 可选：从 downloadAndStore 抽出「已有字节落盘」小函数，供 Stage 2 复用 | 孤儿补偿/清理测试 | 无 | 禁止第二套校验 |
| `src/app/api/` | `images/[id]/pin/route.ts`（Stage 2） | favorites、error-handler、settings | 无 | |
| `src/lib/errors.ts` | 无 | 无（已有 StorageError） | 无 | 只接到 HTTP |
| `src/components/` + i18n | 无 | generate / gallery / dialogs / settings | 收藏时的 `triggerImageDownload` | |
| `electron/` | 无 | openPath 目标 | 无 | |
| `docs/mvp/{library,settings,storage}/` 与 07-21 README | 无 | 语义/路径约定 | 无 | 权威文档必须同步 |
| `tests/contract` `tests/integration` 同目录 unit | pin/favorite 失败与成功 | 现有 favorite mock 改为 async | 无 | 见 04 |

## 2.5 API / 协议 / 迁移与兼容

**`POST /api/favorites`**

- 仍 body `{ imageId }`。
- 成功 200：返回的 GalleryItem `delivery` 必须是 `managed`（新收藏的 remote 不得再回 `remote`）。
- 失败：410 `REMOTE_IMAGE_EXPIRED` / `IMAGE_MISSING` / `IMAGE_EXPIRED` / `IMAGE_DELETED`。`STORAGE_ERROR`：`retryable=true` 用 **503**，`retryable=false` 用 **422**。不要 200 + 半收藏，不要无 details 的 500。
- 幂等：已收藏且已 managed → 200 原样。已收藏但仍 live remote → 仅在用户点「保存到本地」时 POST 并成功后变为 managed；普通 Gallery 加载不得触发 POST。失败不取消已有收藏。

**`POST /api/images/:id/pin`（Stage 2）**

- 只处理 live remote；已 managed 返回 200 且不重写文件。墓碑 410。
- 不在公共 JSON 里回传 `remoteUrl`。

**`GET /api/settings`**

- 增加 `localData.storageDirectory: 'images/'`。这是稳定的逻辑相对路径，不表达主机文件系统位置；日志与 safe-logger 继续禁止打印实际路径。

**兼容**

- 无 DB migration。
- 存量 remote 收藏：不删行、不自动补钉。仍有 URL 的条目可由用户主动保存到本地；链接已死后成为墓碑，红心仍在（历史关系保留，与 07-21「过期保留收藏记录」一致），预览不可用并显示「原图已删除或丢失」。
- 公开 DTO 仍只给 `/api/images/:id`，不把签名 URL 下发。

## 2.6 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 收藏变慢（等下载） | UI 已有 pending；超时沿用 downloadAndStore | 回退 addFavorite 为纯 insert（产品承诺同时撤回） |
| 代理环境 Stage 1 全部失败 | Stage 2；失败诚实 | 无静默降级为假红心 |
| CORS 使 Stage 2 无效 | 04 对抗项；文案不可恢复 | 接受该环境无法收藏 URL 图 |
| 并发：cleanup 过期 vs 收藏钉盘 | promote 与 expire 都用条件更新；收藏事务里 NOT NULL remote_url | 以变化行数为准，失败则 410 |
| 文件系统与 SQLite 非原子 | 下载/字节落盘后，promote 或 favorite 写库可能输给删除/过期 | 条件更新失败或事务失败时立即删除新 storagePath；孤儿清理为崩溃残余兜底 |
| 客户端乱传字节 | 魔数+大小+只写 storageRoot | 与现有 downloadAndStore 同等 |
| Web 暴露物理路径 | 只下发逻辑 `images/`，不写日志 | 无物理路径可泄露 |

## 2.7 与 00 边界对齐检查

| 00 结论 | 02 落点 |
|---------|---------|
| 新收藏在应用内可持续打开 | Stage 1 promote；旧收藏仅用户触发补钉，无来源时保留失效记录 |
| 失败不给假红心 | 先钉盘再 insert；UI 回滚 |
| 「已经存不了了」 | i18n 映射 410 与不可恢复 STORAGE_ERROR |
| 错误字段 KISS | 只补 classifyApiError |
| 打开存储目录 / Web 显示路径 | settings 逻辑 `images/` + Electron openPath(storageRoot) |
| 不做用户收藏夹权威、不做导出、不做全量自动钉、不做 TTL、不做视频 | §2.8 |

## 2.8 不在本轮

- 未收藏 remote 后台自动钉盘（含开关）
- 用户可编辑收藏目录、导出「日期-提示词.png」副本
- 填写各 Provider `remoteTtlMs` 与倒计时 UI
- 视频 remote 交付与收藏钉盘
- 通用代理 / Fake-IP / DNS 修复
- 把 GET `/api/images/:id` 改成有副作用的「打开即钉盘」

上述若升为 improve-2，须在本轮 05 闭环之后，按主动切割或复发返修立项。
