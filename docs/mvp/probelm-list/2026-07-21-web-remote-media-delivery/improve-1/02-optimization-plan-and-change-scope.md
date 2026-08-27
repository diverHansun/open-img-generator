# 2. 优化方案与改动面

## 2.1 架构选择

采用“服务端生成控制面 + 双来源图片记录 + 浏览器媒体数据面”的模块化单体方案。

```text
                         服务端控制面
Browser ──generation──> job-engine ──API Key──> Provider
                             │                    │
                             │              image result
                             ▼                    ▼
                         image source <──── URL / inline
                          ┌────┴────┐
                          │         │
                       remote    managed
                          │         │
                   SQLite URL   data/images
                          │         │
                          └────┬────┘
                               ▼
                   stable same-origin image ID
                     /api/images/:imageId
                               │
                         浏览器媒体数据面
                   preview / explicit download
```

不选以下方案：

- **后端通用代理/图片代理**：图片字节仍经过 Node，无法消除当前网络路径问题，还增加带宽、缓存和 SSRF 复杂度。
- **Provider API 全部移到浏览器**：会暴露 API Key，破坏 job 持久化、并发调度、错误归一化和恢复能力。
- **所有图片只存远程 URL**：ZenMux/Gemini/部分 Doubao 的 inline 输出无法适配，且会破坏既有本地数据。
- **前端 fetch-to-Blob 作为唯一下载**：依赖每家 CDN 的 CORS，整图占用浏览器内存，也不能证明写盘完成。

## 2.2 核心设计决策

| 主题 | 决策 | 理由 | 代价 |
|---|---|---|---|
| 图片来源 | `managed` 与 `remote` 两种 `sourceKind` | 真实表达 URL 与 inline 的差异，不按 Provider 名称分支 | 查询和 UI 必须 source-aware |
| 稳定 URL | 公共 DTO 仍只返回 `/api/images/:id` | 不把签名 URL扩散到 JSON、组件、日志和收藏记录 | 每次预览多一次同源重定向 |
| remote 预览 | 应用路由校验记录后 302/307 到 Provider URL，不代理字节 | 媒体传输使用浏览器网络栈 | 远端过期或不可达会影响预览 |
| 下载入口 | 常驻 icon 指向同源 `GET /api/images/:id/download` | 下载没有业务状态，GET 保持无副作用；用户可重复下载 | remote 最终行为仍受 CDN/浏览器控制 |
| 下载状态 | 不增加 requested/completed 字段 | Web 无法可靠确认落盘；删除无法证明的状态最符合 KISS | 应用不知道用户是否已有本地副本 |
| 收藏 | 每次未收藏→收藏时，同一用户手势触发下载链接，再写 favorite | 满足“收藏默认下载”，不引入下载状态机 | 两个副作用不能原子回滚；重新收藏会再次下载 |
| remote 过期 | 清空敏感 URL，保留 image/favorite/history 墓碑 | 历史可解释，签名 URL 不永久滞留 | 收藏不等于应用内永久可预览 |
| 本地兼容 | 既有/inline 图片继续使用 storage | 无数据破坏，保留完整性校验 | 产品内部存在两种交付方式 |
| 安全 | HTTPS + 精确媒体 host + URL 结构校验；不做 DNS preflight | 服务端不连接 remote URL，Fake-IP DNS 不应阻断引用；仍防开放重定向 | 新媒体 host 需随 ModelSpec 更新 |

## 2.3 数据模型：schema v6

### `images` 新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_kind` | text not null default `managed` | `managed` 或 `remote` |
| `remote_url` | text nullable | Provider 签名 URL；仅服务端使用，禁止写日志/公共 DTO |
| `remote_expires_at` | integer nullable | Provider 明确给出或 adapter 能可靠计算的过期时间；未知则 null |

`removal_reason` 增加 `remote_expired`。如果网络临时失败，不立即写 tombstone。已知 Provider TTL 到达或 Provider 明确返回永久失效时使用 `remote_expired`；未收藏图片达到应用的 7 天保留期限时使用既有 `retention_expired`。两种情况都清除 remote URL，但原因必须可区分。

### 新的行不变量

```text
managed live:
  sourceKind = managed
  storagePath != null
  remoteUrl == null
  removedAt/removalReason == null

remote live:
  sourceKind = remote
  storagePath == null
  remoteUrl != null
  removedAt/removalReason == null

tombstone:
  storagePath == null
  remoteUrl == null
  removedAt != null
  removalReason in
    retention_expired | user_deleted | storage_missing | remote_expired
```

额外约束：

- `sizeBytes` 对尚未下载到应用的 remote 行允许为空；不要通过 HEAD/GET 增加后端网络探测。
- `contentType`、width、height 使用 Provider 可信响应中的 hint；未知可为空。
- remote tombstone 时必须原子清空 `remoteUrl`，避免过期签名长期保留。

### 迁移规则

- 在 `scripts/migrate-db.mjs` 增加 v5 → v6 手写迁移，并更新 `src/lib/db/schema-manifest.json`。
- 所有现有 `images` 行填充 `source_kind='managed'`；其他新字段为空。
- 不修改现有 image ID、favorite、generation、job、storage path 或文件。
- migration 必须遵守现有备份和 schema 自检流程。

不新建独立 `remote_images` 表：remote 与 managed 都是用户看到的 Image，且共享 generation/favorite/delete/history 关系；拆表只会制造跨表 union 和双重 ID。

## 2.4 Provider 结果持久化

### URL 类型

1. adapter 返回 `ProviderImageRef`，并明确 source 是 HTTPS URL。
2. job-engine 调用新的 remote URL validator，不发起 DNS、HEAD 或 GET。
3. 在短事务中插入 `images(sourceKind=remote, remoteUrl=...)`。
4. 所有预期图片记录成功后 job 进入 `completed`，清空 `resultSnapshot`。
5. 若 URL 结构或 host 不符合 Provider 私有 ModelSpec，判为 Provider contract/security error，并保留安全诊断；不得把任意 URL 暴露给浏览器。

URL validator 最小规则：

- 仅允许 `https:`；拒绝 `http:`、`data:`、`file:`、`blob:` 和未知 scheme。
- 禁止 username/password、fragment、超长 URL、控制字符和 IP literal 的本地/私网/保留地址。
- hostname 必须匹配当前 Provider/ModelSpec 明确声明的媒体 host；只允许精确 hostname 或经过评审的受限 suffix，不允许全局 `*`。
- 不解析 DNS：服务端不连接该地址，路由器 Fake-IP 不应参与此校验。
- 日志只记录 provider、model、imageId、hostname 或 hostname hash、过期时间和安全错误码，不记录 query/signature/raw URL。

### Inline/Base64 类型

继续沿用当前 staging、magic/size 校验、原子写入和 `managed` image 创建。只有写入成功才算该图片可用；本地磁盘失败仍属于 storage failure，可沿用 no-replay 与“仅重试保存”设计。

### Provider 类型契约

把 `ProviderImageRef.url` 的隐式双重含义改为可判别类型，例如：

```ts
type ProviderImageRef =
  | { source: "remote"; url: string; expiresAt?: string; /* metadata */ }
  | { source: "inline"; dataUrl: string; /* metadata */ };
```

这是内部契约，不进入公开 Web DTO。adapter 在解析响应时就确定形态，job-engine 不用通过字符串前缀猜测业务语义。

## 2.5 图片读取与下载 API

### `GET /api/images/:imageId`

保持稳定的同源预览地址：

| source/state | 行为 |
|---|---|
| managed live | 现有本地流式读取，支持既有 cache/ETag 语义 |
| remote live、未过期 | 返回受控 302/307 到 `remoteUrl` |
| known expired | 原子 tombstone 后返回 typed 410 `IMAGE_REMOTE_EXPIRED` |
| missing/removed | 沿用相应 typed 404/410 |

remote redirect 响应至少设置：

- `Referrer-Policy: no-referrer`
- `Cache-Control: private, no-store`（避免缓存带签名的 Location）
- 不在响应 body、日志或错误详情重复输出 remote URL

浏览器最终仍能在网络面板看到重定向目标，这是浏览器取得图片的必然结果；目标是避免应用 API JSON 和持久日志无意扩散它，不是假装对本机用户隐藏。

### `GET /api/images/:imageId/download`

下载 icon 使用带 `download`、`target="_blank"`、`rel="noopener noreferrer"` 的同源 `<a>`，接口保持无副作用；若浏览器忽略下载语义，原图在新标签打开，不把当前应用页导航走：

1. 校验当前用户、image、状态和过期时间。
2. managed：返回现有 attachment stream、`Content-Disposition: attachment` 与安全文件名。
3. remote：返回受控 302 到 remote URL，并带 `no-referrer`/`no-store`。
4. 不可用：返回 typed 410/404。

`download` 属性只对同源、Blob 和 Data URL 有规范保障；remote 路由最终跳到跨域 CDN 后，最终响应若没有 `Content-Disposition: attachment`，浏览器可能把 `image/png`、`image/jpeg` 等作为可内联资源在当前页或新标签打开。应用不能在 302 响应上替最终 CDN 响应增加有效的 attachment header，也不能通过签名 URL 随意追加 disposition 参数。

本批不通过 Node proxy 或 CORS Blob hack 强行统一。界面需提供说明：“若浏览器打开原图，请使用浏览器的保存图片/下载操作。”

## 2.6 Web DTO 与展示状态

公开 DTO 不返回 `remoteUrl`。统一返回：

```ts
type ImageAvailability =
  | "available"
  | "retention_expired"
  | "remote_expired"
  | "user_deleted"
  | "storage_missing";

type ImageDelivery = "managed" | "remote";

type ImageView = {
  id: string;
  url: string | null;                 // stable same-origin route
  downloadUrl: string | null;         // stable same-origin GET target
  delivery: ImageDelivery;
  availability: ImageAvailability;
  // existing metadata
};
```

`availability='available'` 表示当前记录可尝试展示，不承诺远端此刻网络一定可达。浏览器 `<img onError>` 只能说明加载失败，不能区分临时断网、代理、CORS/CDN、签名过期，前端不得据此直接把数据库标记为 `remote_expired`。

## 2.7 UI 行为

### 缩略图与大图

- Generate、History、Gallery 均使用稳定同源 `image.url`。
- Improve 1 的“缩略图”是同一 remote source 在列表中的受限展示尺寸，不由 Node 另行下载、缩放和保存；若 Provider 原生返回独立 preview URL，后续可在其私有 ModelSpec 中显式支持，不能通过服务端临时生成缩略图。
- 点击缩略图复用现有 `ImagePreviewDialog` 打开大图。
- 大图 figure 设为定位容器；下载 icon 作为右下角 overlay button，具有可访问名称、键盘焦点和 loading 状态。
- available 时始终显示下载 icon；点击后不隐藏、不置为 completed，允许重复下载。
- remote expired 显示“远程图片链接已过期”，不渲染 broken `<img>`，保留 Prompt、来源、收藏和删除操作。

### 手动下载

1. 用户点击 icon。
2. 同源 anchor 请求 `GET /download`；managed 返回附件，remote 跟随重定向；若最终以内联方式展示，只在新标签打开。
3. icon 保持显示。浏览器下载、打开原图、取消或失败都不改变应用状态。

不要显示无法验证的“下载成功”Toast，也不需要“已发起”状态。

### 收藏触发下载

从未收藏 → 收藏的事件顺序：

```text
same user gesture
  ├─ trigger GET download link
  └─ POST favorite API
```

- 取消收藏：只删除 favorite，不删除浏览器下载的副本。
- 再次从未收藏切换为收藏：再次触发下载，行为简单且可预期。
- favorite API 失败：回滚收藏 UI；外部下载若已发起无法回滚。
- download 被拦截/取消：favorite 可以保留；常驻 icon 允许用户再次下载。

### 失败矩阵

| 浏览器下载动作 | 收藏写入 | 用户结果 |
|---|---|---|
| 已触发 | 成功 | 收藏成功；浏览器接管下载或打开原图；icon 常驻 |
| 已触发 | 失败 | 收藏 UI 回滚；已触发的外部动作不能回滚 |
| 被浏览器阻止/取消 | 成功 | 收藏保留；用户可再次点击常驻 icon |
| 被浏览器阻止/取消 | 失败 | 收藏 UI 回滚；用户可分别重试 |

## 2.8 保留、过期、删除与收藏

| 图片类型 | 未收藏 | 已收藏 | 删除 |
|---|---|---|---|
| managed | 继续按默认 7 天/用户配置清理 | 应用内字节永久保留，直到用户显式删除 | 删除受管文件并 tombstone |
| remote | 创建后最多保留 7 天或更短的已知 Provider TTL；7 天策略记 `retention_expired`，Provider 过期记 `remote_expired` | 永久保留 favorite/image/generation 元数据；remote URL 只保留到已知过期，浏览器副本由用户管理 | 清 URL、删除 favorite 关系并 tombstone；不能删除浏览器副本 |

远程 URL 过期时间：

- Provider 明确返回 expiry：持久化该时间。
- ModelSpec 有官方、稳定、已验证 TTL：adapter 可计算 expiresAt，并在文档/测试中注明来源。
- 无可靠信息：`remoteExpiresAt=null`；仍受未收藏 7 天清理约束。收藏记录可继续尝试 URL，直到服务器明确判定永久失效；不得靠猜测 query 参数建立通用解析器。

Favorite 继续表达用户意图，不因远程链接过期而自动删除。Gallery 必须显示墓碑和生成来源。

## 2.9 安全与隐私

- remote URL 被视为短期敏感凭据，SQLite 本地保存期间不复制到日志、错误文案、analytics 或客户端 JSON。
- 受控重定向仅接受数据库 image ID，不接受 `?url=` 之类任意目标，防止开放重定向。
- 路由每次读取前校验 owner/workspace、source kind、expiry 和 URL host；不得信任客户端提供的 delivery。
- Provider/ModelSpec 的 media host 是最小权限清单；新模型接入真实测试时同步维护。
- error diagnostics 只暴露 safe code、provider/model、image ID、host 名或 hash；query、签名、Prompt、API Key、绝对本地路径必须脱敏。
- remote redirect 不执行服务端 DNS 请求，所以 SSRF guard 不适用；若未来加入 HEAD、缩略图代理或 metadata fetch，必须重新进入完整 SSRF 威胁建模，不能复用本批“无需 DNS”的结论。
- 下载 POST 必须沿用现有认证与同源/CSRF 边界；下载表单不能允许跨 workspace 猜 image ID。

## 2.10 分阶段实施

### Phase 1：兼容读取先行

- 加 schema v6 与 migration，现有行全部 managed。
- 更新 queries/types/invariants，使 remote row 可被安全读取，但 job writer 暂时仍走旧本地路径。
- image read/download route、Gallery/History/Preview UI 先支持两种 source 和 remote tombstone。
- 添加 remote URL validator、日志 schema 和测试。

完成定义：旧数据和所有现有测试不回归；手工 fixture remote row 可预览、下载、过期和收藏。

### Phase 2：切换 URL 写入生命周期

- ProviderImageRef 改为可判别 source。
- URL result 插入 remote image，不调用 `storage.downloadAndStore()`。
- inline result 保留现有 managed 落盘。
- job snapshot、完成条件、错误分类和诊断同步更新。

完成定义：URL Provider 在 Node 媒体下载不可用时仍 completed；Base64 Provider 仍只有安全写入后 completed。

### Phase 3：下载与收藏 UX

- 预览大图右下角 download icon。
- 无状态 GET 下载入口；icon 对可用图片始终显示。
- 每次未收藏→收藏触发下载的双副作用流程及失败提示。
- Gallery/History remote expired 墓碑和 i18n/a11y。

完成定义：刷新、取消收藏、再次收藏、浏览器阻止新标签等边界与 04 一致。

### Phase 4：保留、日志与文档收口

- retention 支持 remote URL 清理和 `remote_expired`。
- cleanup 不把 remote 行当本地 orphan，也不尝试删除用户下载目录。
- 日志新增 remote reference accepted/rejected、redirect served、expired 事件；日志不形成下载业务状态。
- 同步模块权威文档、`.env.example`（若 TTL 可配置）和用户说明。

## 2.11 具体改动面

| 区域 | 主要文件/目录 | 改动 |
|---|---|---|
| DB/migration | `src/lib/db/schema.ts`、`schema-manifest.json`、`scripts/migrate-db.mjs` | source、remote URL/expiry、约束和 v6 迁移 |
| DB queries | `src/lib/db/queries/images.ts`、favorites/retention queries | 创建 remote row、过期 tombstone、source-aware 查询 |
| Provider contract | `src/lib/providers/types.ts`、各 Provider 私有 ModelSpec/adapter | discriminated result、媒体 host/TTL |
| URL policy | 新增 `src/lib/media-output/remote-url.ts` 或同职责最小模块 | HTTPS/host/长度/IP literal 校验与脱敏诊断 |
| Job lifecycle | `src/lib/job-engine/lifecycle.ts`、orchestrator/types/tests | URL 直接持久化；inline 继续 storing |
| Storage | `src/lib/storage/index.ts`、cleanup/retention | 只管理 managed bytes；不下载 remote |
| API | `src/app/api/images/[id]/route.ts`、`download/route.ts` | source-aware stream/redirect、无状态 GET download、typed 410 |
| Library/View | `src/lib/library/*`、`src/lib/web-client/types.ts` | delivery、availability，禁止 raw URL |
| UI | preview/detail/generate/gallery/history 组件与样式/i18n | 常驻 overlay icon、收藏触发、过期墓碑 |
| Observability | safe logger 与事件 schema | 只记录 safe metadata |
| Tests | unit/contract/integration/smoke/e2e | 见 04 |
| Docs | storage/job-engine/api/providers/README | 更新完成条件、source 与收藏语义 |

实现中如发现视频与图片共用的 query 必须修改，只允许保持旧视频行为，不得顺手把 remote video 纳入本批。

## 2.12 发布与回滚

按 expand-and-contract 发布：

1. 先部署 Phase 1 reader/schema/UI，writer 仍只产生 managed 行。
2. 验证旧图片、Gallery、download、cleanup 后，再部署 Phase 2 remote writer。
3. 一旦生产/真实环境已有 remote 行，只能回滚 writer 到 managed，不能回滚 v6 reader/schema；否则旧代码会把合法 remote 行当 storage missing。
4. 保留 remote reader，待所有 remote 行过期/迁移后才可考虑撤回 schema。

无需全局功能开关。若真实 Provider 发现某个模型的 remote host 尚未准入，只回退该 ModelSpec 到 managed transfer 或暂时隐藏该模型，不允许放宽全局 host 规则。

## 2.13 实施停止条件

出现以下任一情况必须停止并重新讨论：

- 用户要求 Web 确认真实磁盘下载完成或获知本地路径；普通浏览器能力不足。
- 用户要求收藏后应用内永久显示 remote 原图；需要应用受管副本或 Electron 下载登记。
- 某 Provider 既不返回可持久 URL，也不返回 inline 数据；需要专属获取协议。
- remote preview 需要应用代理、缩略图变换或服务端 HEAD；安全与网络模型已发生变化。
- 实施需要改动视频交付、跨设备同步或云对象存储。
