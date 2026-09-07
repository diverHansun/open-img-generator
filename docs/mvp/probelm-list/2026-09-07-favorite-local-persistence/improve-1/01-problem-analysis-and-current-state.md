# 1. 问题基线与当前实施状态

> 时间口径：2026-09-07 规划时。代码基线 `main@22a757c`。本议题尚未改代码。

## 1.1 问题陈述

1. **收藏在应用里只是一条标记，不是一份文件。** `addFavorite` 只插入 `favorites` 行；fal / qwen / zhipu / siliconflow 等 URL 图的字节从未进入 `LOCAL_STORAGE_DIR`。
2. **远程链接过期后，红心还在、图没了。** 预览对 remote 是 302 到 Provider CDN；`markRemoteImageExpired` 不看是否收藏。
3. **点收藏触发的「下载」救不了应用内展示。** 浏览器把文件存到系统下载目录，应用既不知道路径，也不读那份副本。
4. **失败体验是假成功 + 泛化文案。** 乐观更新先亮红心；API 失败只说「收藏状态更新失败」。`StorageError` 根本进不了结构化 API 错误。
5. **用户在设置里找不到收藏图放哪。** 桌面版能打开「数据目录」；Web 主路径下既不展示 `getStorageRoot()`，打开按钮也是禁用的。

## 1.2 已确认的产品/技术分界

见 [00-discussion.md](./00-discussion.md)。一句话：

```text
未收藏 remote  ──302──► Provider CDN（沿用 07-21）
收藏成功       ──必须──► managed 文件 + favorites 行
收藏失败       ──必须──► 无红心 + 诚实原因
设置           ──Web 显示逻辑路径 images/ / 桌面打开存储根──► getStorageRoot()
```

不把用户文件夹当权威；不自动钉所有未收藏图。

---

## 1.3 library（收藏 / Gallery）

### 1.3.1 goals-duty

`docs/mvp/library/goals-duty.md`：Gallery 只展示收藏的 Image；Non-Duty「不执行转存图片，归属 job-engine + storage」。

**gap：** 07-21 之后转存不再发生在 job 完成时。收藏域成了「用户表达永久保留」的唯一切点，但 library 没有转存职责，也没有人在收藏时调用 storage。职责出现空洞，不是越界。

### 1.3.2 architecture

`favorites.ts` 只依赖 db。`library/images.ts` 已经依赖 storage（`getReadStream` / `removeStoredFile`），所以「收藏路径调用 storage」并不破坏现有依赖方向（library → db / storage；禁止 library → job-engine 仍然成立）。

### 1.3.3 data-model

`Favorite` 是 `image_id` 关系，不含字节。`GalleryItem.delivery` 直接投影 `sourceKind`。收藏成功与 `delivery === 'managed'` 无任何约束。

### 1.3.4 dfd-interface

当前流：UI → `POST /api/favorites` → `addFavorite` → insert。无字节流。`GET /api/images/:id` 对 remote 在 `openDeliverableImage` 校验后 302。

### 1.3.5 use-case

UC4「收藏进 Gallery」两步：点收藏、列表展示。没有「字节必须落地」；也没有失败回滚语义。

### 1.3.6 non-functional

不适用独立 SLA。可靠性缺口见远程过期。可观测性：`openReadableImage` 在文件缺失时记 `storage.missing_detected`（含 `wasFavorite`）；remote 过期没有对等的「收藏但钉盘失败」事件。

### 1.3.7 test

- `src/lib/library/library.unit.test.ts`：幂等收藏、墓碑不可收藏。
- `tests/contract/library-api.contract.test.ts`：`addFavorite` 被 mock 成同步函数，契约是「200 + 调用 library」，不测落盘。
- `tests/integration/sync-generation.integration.test.ts`：收藏后 `favorited: true`，不断言 `sourceKind` / 文件存在。

**缺口：** 没有「remote 收藏 → managed + 文件」测试，也没有「下载失败不得插入 favorites」测试。

**代码锚点**

- `src/lib/library/favorites.ts` · `addFavorite`（约 L86–107）：只校验 image 仍 live（有 `storagePath` 或 `remoteUrl`），然后 insert。
- `src/app/api/favorites/route.ts` · `POST`：同步调用 `addFavorite`。
- `src/lib/library/images.ts` · `openDeliverableImage`（约 L56–80）：remote 走 URL，不尝试落盘。

---

## 1.4 storage 与 cleanup

### 1.4.1 goals-duty

`docs/mvp/storage/goals-duty.md` 目标 1：把厂商临时 URL 变成本地可持久资产。Duty 4：清理保留期外**且未收藏**的图片。

**文档 vs 代码：** inline / managed 路径仍转存；URL 图在 job 完成时不再转存（07-21）。收藏永不删只对**已有 `storagePath` 的 managed 行**成立。

### 1.4.2 architecture / 数据流

`downloadAndStore`（`src/lib/storage/index.ts` L564+）已具备 SSRF 校验、大小上限、魔数、原子 rename。这正是收藏钉盘应复用的路径，不必新写存储栈。

`cleanupStoredImages`（`src/lib/storage/cleanup.ts`）：

1. `listKnownRemoteExpiryCandidates` → `markRemoteImageExpired`：**不检查 favorites**。
2. `listRetentionCandidates` → `markImageExpiredIfUnfavorited`：有 `NOT EXISTS favorites` 保护。

同一轮清理对两类过期用了两种语义。

### 1.4.3 data-model

`images` 行不变量（`src/lib/db/schema.ts` `images_availability_check`）：

| 状态 | sourceKind | storagePath | remoteUrl |
|------|------------|-------------|-----------|
| live managed | managed | 非空 | 空 |
| live remote | remote | 空 | 非空 |
| tombstone | 任意 | 空 | 空 + removedAt |

因此「钉盘」= 把 live remote 更新成 live managed，不能同时留 `remoteUrl`。已有 `restoreImageStorageIfMissing`（L430+）只接受 `storage_missing` 墓碑，**不能**用于仍存活的 remote 行。

### 1.4.4 test

`src/lib/db/queries/images.unit.test.ts` 覆盖 remote 过期墓碑、未收藏 retention、`restoreImageStorageIfMissing`。没有「收藏保护 remote TTL」用例——因为当前实现本来就不保护。

**代码锚点**

- `src/lib/storage/cleanup.ts` L122–129 vs L140–144
- `src/lib/db/queries/images.ts` · `listKnownRemoteExpiryCandidates` L244–255、`markRemoteImageExpired` L413–428、`markImageExpiredIfUnfavorited` L261–295

---

## 1.5 job-engine / providers（交付形态）

URL 型 ModelSpec 声明 `imageOutput.delivery: 'remote'`（qwen / fal / zhipu / siliconflow 等）。`remoteTtlMs` 只出现在 `src/lib/providers/model-spec.ts` 与 `src/lib/media-output/remote-url.ts` L85–87；capabilities 中 **0 处赋值**，故 `remoteExpiresAt` 多为 `null`。结果：

- 应用经常不知道何时过期；
- cleanup 的「已知 TTL」分支经常不跑；
- 用户侧表现是「过几天 302 变 403/404」，而不是准时墓碑。

本轮 **不**补 TTL（00 已确认）。它解释现象，但不是本轮方案的承重项。

job-engine 在 remote 交付时不调用 `downloadAndStore`（见 `lifecycle.unit.test.ts` 中 `not.toHaveBeenCalled`）。生成成功 ≠ 应用拥有字节。这是 07-21 的有意设计，本轮只在**收藏切点**改，不改 job 完成条件。

---

## 1.6 web-ui 与错误面

### 1.6.1 收藏交互

`src/components/generate/generate-stage.tsx` `toggleFavorite`（约 L219–263）：

1. 乐观补丁红心；
2. 若即将收藏，立刻 `triggerImageDownload(imageId)`（`src/lib/web-client/image-download.ts`：创建 `<a href=/api/images/:id/download>`）；
3. 再 `addFavorite`；
4. 失败则回滚红心，`favoriteError` 布尔值 → 文案 `generate.favoriteError`（「收藏状态更新失败，请重试。」）。

同样模式出现在 `generation-detail-dialog.tsx`、`gallery-screen.tsx`。三处都不区分「网络失败可重试」和「字节已经救不回来」。

下载路由 `src/app/api/images/[id]/download/route.ts` 对 remote 仍是 302。即使用户在浏览器里存了一份，应用预览仍走 CDN。

### 1.6.2 API 错误字段

`src/lib/errors.ts` 已有完整 `StorageError` + `STORAGE_DIAGNOSTIC_CATEGORIES`（`remote_download_failed`、`remote_http_rejected`、`remote_content_invalid` 等）。job-engine 生命周期使用这些字段。

`src/app/api/error-handler.ts` · `classifyApiError` **没有** `StorageError` 分支，落入 `INTERNAL_ERROR`（500，`retryable: true`，无 `details.category`）。即使收藏开始调用 `downloadAndStore`，前端也读不到可映射文案的字段。这就是 00 说的「存储错误字段要做好」的现状缺口；不需要新错误类型。

`ImageUnavailableError` 已映射：`REMOTE_IMAGE_EXPIRED` / `IMAGE_EXPIRED` / `IMAGE_MISSING` / `IMAGE_DELETED` → 410。收藏失败应复用它们，而不是再发明 `PIN_FAILED` 枚举。

### 1.6.3 设置页

`src/components/settings/settings-screen.tsx` L267–289：

- 有 `desktopInfo`（Electron IPC）时展示 `dataDirectory` 并启用「打开数据目录」；
- Web：只显示「浏览器不能安全地打开本机应用数据目录」，**不展示逻辑路径**，按钮 disabled。

`GET /api/settings`（`src/app/api/settings/route.ts`）返回占用字节与 `webCapabilities.canOpenDataDirectory: false`，**不含** `getStorageRoot()`。`getLocalDataSummary()` 内部已经知道该路径，只是不输出。

桌面打开的是 `electron/main.ts` 的 `paths.root`（数据根：库、设置、日志、媒体），不是专门的图片存储根。用户要的是「收藏图所在文件夹」→ 应对准 `getStorageRoot()`。

**代码锚点**

- `src/lib/i18n/messages/generate.ts` · `generate.favoriteError`
- `src/lib/app-settings/service.ts` · `getLocalDataSummary` L106–116
- `docs/mvp/settings/dfd-interface.md` §1：明确「向浏览器返回不含绝对路径」。本轮应保持该约束，只给 UI 一个逻辑相对路径 `images/`，不是将 `getStorageRoot()` 下发。

---

## 1.7 跨模块一致性

| 链路 | 现状 | 断裂点 |
|------|------|--------|
| job-engine 完成 → image 行 | remote 只写 URL | 故意；本轮不改完成条件 |
| 收藏 → storage | 不调用 | 本轮主断裂 |
| 收藏 → 浏览器下载 | 有，但文件在系统下载目录 | 与应用内展示无关 |
| cleanup retention | 跳过收藏 | 仅 managed 有意义 |
| cleanup remote TTL | 不跳过收藏 | 已失效的历史收藏保留关系但失去下载来源；不能靠 cleanup 自动补救 |
| 设置「不清理收藏」文案 | `settings.retention.description` | 对 remote 收藏承诺过满 |
| settings 占用统计 | 统计 `getStorageRoot()` | remote 收藏不占 mediaBytes，UI 会低估「已收藏」 |

`docs/mvp/library/architecture.md` 禁止 library → job-engine，未禁止 library → storage。钉盘放在 library 收藏命令内，由 API 编排，符合现有 `library/images.ts` 先例。

---

## 1.8 改动影响面（现状视角）

| 区域 | 为何会被碰到 |
|------|----------------|
| `src/lib/library/favorites.ts` | 收藏命令要从同步 insert 变为「必要时 await 钉盘再 insert」 |
| `src/lib/db/queries/images.ts` | 需要 live remote → managed 的条件更新（现有 restore 不够） |
| `src/lib/storage/cleanup.ts` | remote 到期仍写墓碑并保留 favorite；不得隐式下载或补钉 |
| `src/app/api/error-handler.ts` | 漏接 `StorageError` |
| `src/app/api/favorites/route.ts` 与可能的 pin 上传入口 | POST 变真正的 I/O |
| `src/components/generate/*`、`gallery-screen.tsx`、`generation-detail-dialog.tsx`、工作区壳层 | 去掉收藏时自动浏览器下载；按 error.code 分文案；复用全局顶部提示卡片与旧收藏「保存到本地」动作 |
| `src/app/api/settings/route.ts`、`settings-screen.tsx` | Web 输出并展示存储路径 |
| `electron/main.ts` / desktop bridge | 打开目标对准存储根（若与数据根不同） |
| 权威文档 | library UC4、settings dfd/use-case、07-21 收藏语义、storage goals 需标注修正 |

不改 schema 版本即可表达钉盘（复用现有 managed/remote 不变量）。无迁移脚本也能上线；**存量 remote 收藏**不自动变 managed：仍有 URL 时提供用户触发的补钉，已失去 URL 时保留 favorite 关系并显示失效状态。这是对历史数据可诚实作出的最大承诺。

超出单轮承载：否。视频、TTL、全量自动钉盘已切出。

---

## 1.9 SWE 原则审视摘要

- **本质 vs 偶然复杂度（00 哲学）：** 「CDN 会过期」是本质的。另建收藏目录、下载状态机、按 Provider 分支，是偶然复杂度。正确做法是在已有 `managed` 状态上钉钉子。
- **高内聚（02）：** 收藏命令应包含「永久可见」所需的全部步骤；把落盘留在 job-engine 或浏览器下载目录，是把一个用户意图拆到三个模块且无法原子化。
- **KISS / YAGNI（03）：** 不要新错误类型、不要 `pin_status` 列、不要用户可写收藏根。补上 `classifyApiError` 的 `StorageError` 分支即可把字段做对。
- **错误的抽象比重复更糟：** Generate / Dialog / Gallery 三处收藏逻辑重复，本轮只要求错误码映射一致；不强制抽公共 hook，除非实施时改动面已经碰齐三处。
- **可逆 vs 不可逆：** 收藏语义从「书签 + 浏览器下载」改为「应用拥有字节」是产品契约变更（对用户不可逆的期望）。技术上可回滚代码；文档必须把 07-21 对应条款标为 superseded。Web 只展示逻辑路径 `images/`，不暴露绝对路径，保持 settings 的信息隐藏边界。

有意识的合理权衡：未收藏 remote 继续 302——这是 07-21 为 Fake-IP 环境保住「生成成功」的设计，本轮不推翻。

---

## 1.10 与既有文档关系

| 文档 | 角色 | 本轮关系 |
|------|------|----------|
| `docs/mvp/probelm-list/2026-07-21-web-remote-media-delivery/` | 远程预览与「收藏=下载」的权威 | **收藏语义被本轮 superseded**；remote 预览仍有效 |
| `docs/mvp/storage/goals-duty.md` | 转存目标 | 与 07-21 实现冲突；本轮收藏路径与之重新对齐 |
| `docs/mvp/storage/architecture.md` | cleanup / downloadAndStore | 实施后补「收藏钉盘」与 remote 过期对收藏的处理 |
| `docs/mvp/library/goals-duty.md` UC4 / architecture | 收藏不转存 | 需改为：收藏命令可以调用 storage，仍不调用 job-engine |
| `docs/mvp/settings/dfd-interface.md`、`use-case.md` | 不向 Web 返回绝对路径 | 本轮保持约束，补逻辑相对路径与桌面打开图片目录的说明 |
| `docs/mvp/settings/goals-duty.md` Non-Duty 4 | Web 不打开文件夹 | 仍成立；改为显示路径 |
| `scripts/recover-missing-media.ts` | 一次性格迁移抢救 | 证明「收藏了但文件没了」已在真实数据上发生过；本轮不把它升级成产品功能 |

07-21 `improve-1/00-discussion.md` §0.6 原文已写：若用户要求收藏后应用内永远能显示原图，必须恢复受管落盘。本轮就是该预告的执行。
