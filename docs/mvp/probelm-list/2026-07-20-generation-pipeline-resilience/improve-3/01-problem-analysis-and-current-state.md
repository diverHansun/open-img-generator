# 1. 问题基线与当前实施状态

> 时间口径：2026-07-21，分支 `mvp`，代码基线 `6c0714d`。本文只描述当前事实与 gap，不把 02 的目标方案写成已实施。

## 1.1 问题陈述

| ID | 当前矛盾 | 用户影响 | 严重性 |
|---|---|---|---|
| P-01 | Provider 已生成图片，但 URL 转存仍依赖 CDN、DNS、代理和本地安全策略 | 用户看到“生成图片未能安全保存”，已生成结果不可用 | 高 |
| P-02 | 豆包代码能够解析 `b64_json`，请求却固定 `response_format: 'url'` | 无必要地进入最易失败的远端下载路径 | 高 |
| P-03 | cleanup 直接删除图片 DB 行，历史无法表达“曾生成但已过期” | 完成任务退化成“0 张图片/尚无图片”，信息错误 | 高 |
| P-04 | `images.storage_path` 为 NOT NULL，API/DTO 默认“有图片行就一定有文件” | 无法保留轻量墓碑，文件缺失只能变成 404 | 高 |
| P-05 | 保留期默认 30 天且环境变量直接 `Number()`，非法值语义不清 | 与已确认 7 天策略不一致，配置错误可能静默失效 | 中 |
| P-06 | 只有收藏/取消收藏，无图片主动删除和标准下载契约 | “永久保留直到主动删除”与“导出副本”无法完整落地 | 中 |
| P-07 | 浏览器与 Node 后端的网络栈不是同一个边界 | 用户开启浏览器/系统代理后，后端仍可能走不同路径 | 中 |
| P-08 | History 的图片计数来自现存 `images` 行 | cleanup 后统计减少，不能作为“历史生成结果数” | 中 |

## 1.2 当前核心数据流

```text
Provider response
  ├─ data:image/...;base64,...
  │    → bounded staging file
  │    → validate MIME/magic/25 MiB
  │    → atomic materialize
  └─ https://temporary-cdn/...
       → URL/redirect/DNS/IP policy
       → backend fetch (not browser fetch)
       → validate MIME/magic/25 MiB
       → atomic materialize
             ↓
       images row(storage_path NOT NULL)
             ↓
       GET /api/images/:id → local read stream
             ↓
       retention cleanup → DELETE images row → remove file
```

内联与 URL 最终都会落到同一 storage materialization，因此“内联优先”不需要第二套存储架构；问题主要在 adapter 的响应选择和图片生命周期的数据模型。

## 1.3 Provider 适配现状

### 1.3.1 当前代码能力

| Provider | 当前 adapter 输出 | 内联能力现状 | URL 路径风险 | 代码锚点 |
|---|---|---|---|---|
| ZenMux | `b64_json` 或 `url` | 已将 Base64 转为 Data URI；实际 GPT image 响应默认常为 Base64 | URL fallback 仍需转存 | `src/lib/providers/adapters/zenmux.ts::parseImages` |
| 豆包 | 请求固定为 URL；解析兼容 URL/Base64 | 官方支持 `b64_json`，代码解析已存在 | 当前无必要地依赖 CDN | `src/lib/providers/adapters/doubao.ts::buildRequestBody/parseImages` |
| fal | queue poll 完成后 `images[].url` | `sync_mode=true` 可返回 Data URI，但改变请求历史/异步语义 | 受媒体 host、代理和过期策略影响 | `src/lib/providers/adapters/fal.ts::submit/poll` |
| SiliconFlow | `images[].url` | 官方响应 schema 未提供输出 Base64 | URL 约 1 小时，必须立即转存 | `src/lib/providers/adapters/siliconflow.ts::parseImages` |
| 智谱 | `data[].url` | 官方响应 schema 未提供输出 Base64 | URL 为临时资产，当前真实环境已出现 fake-IP 拒绝 | `src/lib/providers/adapters/zhipu.ts::parseImages` |
| 通义千问 | async result URL | Base64 主要用于输入，不是输出契约 | task/result URL 临时，必须立即转存 | `src/lib/providers/adapters/qwen.ts::parseResults` |
| 可灵 | async result URL | 未发现官方输出 Base64 契约 | URL 寿命未在当前官方资料中明确 | `src/lib/providers/adapters/kling.ts::parseImages` |

### 1.3.2 HTTP 与 Base64 边界

- `src/lib/providers/http-client.ts` 把普通 JSON 响应限制为 2 MiB，内联图片 JSON 限制为 36 MiB。
- `src/lib/storage/index.ts::stageInlineImage/writeBase64ToTemporary` 分块解码 Base64，解码后上限 25 MiB，只允许 PNG/JPEG/WebP，并验证 magic bytes。
- durable `result_snapshot` 只保存 `staging:<uuid>`，不保存 Base64 原文；见 `src/lib/job-engine/lifecycle.ts` 的 staging/persist 路径。

现有边界已经足以支持 ZenMux/豆包单次有界内联结果。Base64 会增加约三分之一传输体积和响应解析内存，但对本机单用户、当前单图/有限 count 与 36 MiB 上限可接受。若未来厂商允许多张大图导致响应预算不足，应以实测数据另开议题，而不是本批预扩容。

## 1.4 storage 与图片生命周期现状

### 1.4.1 goals-duty

`docs/mvp/storage/goals-duty.md` 规定 storage 负责把 Provider/CDN 临时结果转成稳定本地资产，并执行生命周期清理。当前职责边界合理；不应把 Provider 特例、收藏业务或 App 宿主代理发现塞入 storage。

### 1.4.2 architecture / dfd-interface

- `src/lib/storage/index.ts::downloadAndStore` 同时接受 staging、Data URI 和远端 URL，最终返回 `storagePath/contentType/sizeBytes`。
- `src/lib/storage/image-url-policy.ts::validateRemoteImageUrl` 对 URL、DNS/IP 和 redirect 做 SSRF 防护；improve-2 增加精确 host + `198.18/15` 的窄例外。
- `src/lib/storage/cleanup.ts::cleanupStoredImages` 每次先 `deleteImageIfUnfavorited()` 删除 DB 行，再删除文件；DB 删除与文件删除不在同一原子介质中，失败文件由 orphan cleanup 兜底。
- `src/lib/job-engine/worker.ts::startWorker` 首次 tick 即可运行 cleanup，之后默认每小时一次；服务关闭期间不清理，重启后补做。

### 1.4.3 non-functional

现有“先删 DB 行，再删文件”对于彻底移除图片是安全的：并发收藏由 `NOT EXISTS favorites` 守护，文件删除失败只留下不可引用 orphan。但它无法满足新历史语义，因为 DB 行本身就是唯一的图片历史身份。

最小修正不是新建资产服务，而是把同一 `images` 行从“活文件索引”扩展为“图片历史身份 + 可选活文件”。这是一项 schema/API 契约的一扇门决策，但由明确的产品要求驱动，复杂度已经被证据挣得。

## 1.5 数据模型现状

### 1.5.1 schema

`src/lib/db/schema.ts` 当前定义：

- `images.storage_path TEXT NOT NULL`；
- 没有 `removed_at`、`removal_reason` 或 availability；
- `favorites.image_id → images.id ON DELETE CASCADE`；
- `(generation_job_id, index)` 唯一。

`src/lib/db/schema-manifest.json` 当前版本为 v3。`scripts/migrate-db.mjs` 已提供：

- 版本顺序迁移；
- 迁移前 SQLite backup；
- `BEGIN IMMEDIATE` 事务；
- required schema 与 `foreign_key_check`；
- smoke tests。

因此 v4 应沿用现有机制重建 `images`（SQLite 不能直接移除 NOT NULL），而不是引入第二套迁移工具。

### 1.5.2 query / read model

- `src/lib/db/queries/images.ts::listRetentionCandidates` 查询超过 cutoff 且无 favorite 的图片。
- `deleteImageIfUnfavorited` 物理删除行；并发 favorite 成功时删除失败，避免误删收藏。
- `src/lib/job-engine/orchestrator.ts::toGenerationView` 把每个 image 行无条件映射成 `/api/images/:id`。
- `src/lib/library/history.ts::toSummaries/getProjectHistory` 只读取现存 image 行，并用 `count(images.id)` 统计图片数。
- `src/lib/library/summaries.ts::listProjectSummaries` 同样用全部 image 行统计历史图片数，并从最新 image 行构造首页项目封面；墓碑引入后“总数包含历史、封面只选 available”必须拆开表达。
- `src/app/api/images/[id]/route.ts` 无条件以 `storagePath` 打开文件；行不存在或文件缺失统一成为 404。

当前模型无法区分下列真实状态：

| 真实状态 | 当前可见结果 |
|---|---|
| Provider 从未返回图片 | Job error/0 images |
| 图片保存失败 | Job `STORAGE_ERROR`/0 images |
| 图片曾成功但 30 天清理 | image 行消失/0 images |
| 用户在文件系统外部删文件 | image 行存在，但 GET 404 |
| 未来用户主动删除 | 无 API/无状态 |

这违反最小惊讶原则：一个 completed Job 的历史结果会随 cleanup 退化成“没有返回图片”。

## 1.6 API、下载与 UI 现状

### 1.6.1 图片读取

`GET /api/images/:id` 当前只返回 inline 内容流，无 availability DTO、无 `410 Gone` 区分，也没有 `Content-Disposition` 下载路径。

### 1.6.2 收藏与删除

- `POST /api/favorites` 与 `DELETE /api/favorites/:imageId` 只表达收藏/取消收藏。
- `src/lib/library/favorites.ts` 和 Gallery 都假设 favorite 指向可读取图片。
- 没有 `DELETE /api/images/:id`；因此“收藏永久保留直到主动删除”缺少主动删除动作。

### 1.6.3 Web read model

`src/lib/web-client/types.ts::ImageView` 的 `url` 是必填字符串，没有 availability/removal reason。Generation、History、详情弹窗、缩略图和 Gallery 都把 image row 当作可显示图片。i18n 只有“尚无图片”，没有“已过期/已删除/文件缺失”。

浏览器 Web 只能通过标准下载响应触发保存；用户具体选择目录取决于浏览器设置。未来 App 才能用原生“另存为”对话框，但当前尚未确定宿主技术。

## 1.7 网络边界现状

Provider API 与远端图片下载都发生在 Next/Node 后端。浏览器访问 `localhost` 使用的网络设置，不等于 Node `fetch` 自动继承相同代理。因此：

- TUN/透明代理通常可以覆盖后端进程，但 fake-IP 可能触发 SSRF 地址分类；
- 仅配置在浏览器或代理软件显式端口上的流量，不一定被 Node 后端使用；
- improve-2 的 `TRUSTED_PROXY_IMAGE_HOSTS` 是精确、显式、有限的当前兼容，而不是通用系统代理继承；
- App 宿主确定前，无法诚实承诺“复用系统网络栈”的具体实现。

本批能通过 ZenMux/豆包内联减少 CDN 下载，但 URL-only Provider 仍必须保留安全下载路径。删除整个网络层同样不符合正确性。

## 1.8 测试现状与缺口

项目级 `docs/test-blueprint.md` 已定义 unit/contract/integration/smoke 与真实 Provider opt-in 边界。现有测试包括：

- `src/lib/storage/cleanup.unit.test.ts`：物理删除未收藏行/文件、保留收藏、orphan/staging；
- `src/lib/db/queries/images.unit.test.ts`：retention query 与 favorite guard；
- `tests/smoke/db-migrate.smoke.test.ts`：迁移与 favorites schema；
- `tests/integration/sync-generation.integration.test.ts`：生成→落盘→收藏；
- Provider adapter unit tests：请求/响应解析与 timeout；
- library/API contract tests：History/Favorites DTO。

缺口集中在真实风险，而非覆盖率数字：

1. v3→v4 重建 `images` 时保持 image/favorite/FK/unique index。
2. cleanup 与并发 favorite、主动 delete 的线性化。
3. tombstone 后文件不可读但历史仍可解释。
4. missing file 与 retention expiry 不混淆。
5. 下载副本不更新 createdAt/removal/favorite。
6. 豆包 `b64_json` 请求与 URL fallback。
7. History 总数/缩略图在部分图片保留、部分图片过期时一致。

## 1.9 文档与实现对照

| 权威文档 | 文档当前说法 | 代码当前行为 | gap |
|---|---|---|---|
| `docs/mvp/storage/architecture.md` | 默认 30 天，删除过期未收藏图片 | DB 行和文件都删除 | 需改为 7 天 + tombstone |
| `docs/mvp/storage/dfd-interface.md` | cleanup 不影响图片读取契约 | 删除后读取 404 | 需定义 availability/410 |
| `docs/mvp/db/data-model.md` | images 是持久化图片记录 | `storage_path` 必填，无移除状态 | 需 schema v4 |
| `docs/mvp/api/constraints.md` | 图片实体 MVP 不可删 | 无主动删除/下载契约 | 用户已确认改变该边界 |
| `docs/mvp/library/data-model.md` | History 图片来自现存 image 行 | cleanup 后从历史消失 | 需保留 tombstone read model |
| `docs/mvp/providers/*` | adapter 统一返回 ProviderImageRef | 豆包可解析 Base64 但请求 URL | 需记录内联优先矩阵 |
| `docs/mvp/web-client/*` | `ImageView.url` 必填 | 所有 UI 假设文件可读 | 需 availability + nullable url |

实施完成前，以本文描述当前事实；实施完成后必须回写上述权威文档，避免 problem-list 长期成为唯一真相。

## 1.10 SWE 与架构原则审视

### 直接指导本批的原则

- **正确性优先**（SWE 00）：不能为了省 schema 迁移继续把已过期显示成“未返回图片”。
- **KISS/YAGNI**（SWE 03）：只增加当前需要的墓碑字段、下载/删除接口和一个保留期解析器；不增加资产服务、回收站、代理发现或插件式 retention engine。
- **最小惊讶**（SWE 03）：completed 历史必须稳定；取消收藏不等于主动删除；下载不暗中续期。
- **信息隐藏/SRP**：Provider 只决定返回格式；storage 处理字节；library/db 管生命周期；UI 只消费 availability DTO。
- **可逆性**（架构框架）：默认 7 天与豆包 response format 可快速回滚；schema v4 和公开 DTO 是高成本决策，必须有备份、兼容与测试。

### 风险与债务地图

| 问题 | 严重性 | 投入类型 | 依据 | 建议 |
|---|---|---|---|---|
| cleanup 抹掉历史身份 | 架构/高 | 战略投资 | P-03/P-04 | schema v4 墓碑 |
| 豆包无必要 URL 下载 | 设计/高 | 低垂果实 | P-01/P-02 | 请求 `b64_json` |
| History/DTO 假设文件永存 | 设计/高 | 战略投资 | P-08 | availability + nullable URL |
| retention 配置无严格解析 | 代码/中 | 低垂果实 | P-05 | 单一 policy resolver |
| 通用代理自动发现诉求 | 架构/低收益 | 暂缓 | P-07 | 当前窄兼容，App 宿主决定后复用系统栈 |
| 下载历史/回收站/配额框架 | 产品/低收益 | 暂缓 | 无当前证据 | 不实施 |

## 1.11 改动影响面

预计涉及：

- `src/lib/providers/adapters/{doubao,zenmux}.ts` 与 adapter/HTTP tests；
- `src/lib/db/{schema.ts,schema-manifest.json,queries/images.ts}`、`scripts/migrate-db.mjs`、DB helpers/smoke tests；
- `src/lib/storage/{cleanup.ts,index.ts}` 与 unit/integration tests；
- `src/lib/job-engine/orchestrator.ts`、`src/lib/library/{history,favorites,...}.ts`；
- `src/lib/library/summaries.ts` 的项目图片总数与 available cover 选择；
- `src/app/api/images/[id]/route.ts` 及新增 download/delete contract（最终路由形态见 02）；
- `src/lib/web-client/{types,api-client}.ts`；
- Generation/History/Gallery/详情 UI 与中英文 i18n；
- `.env.example`、README、`docs/mvp/{api,db,storage,library,providers,web-client,web-ui}`。

不应改动 Provider submit/poll/cancel 的 durable lifecycle、fal/Qwen/Kling async 状态机、全局 SSRF 默认拒绝或真实 Provider E2E 的 opt-in 规则。
