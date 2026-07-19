# 2. 优化方案与改动面

> 本文是后续实施会话的执行契约，不表示功能已经落地。<br>
> 范围来源以 `00-discussion.md` 为准，验收以 `04-test-and-acceptance.md` 为准。

## 2.1 方案总览

保持现有 Next.js 模块化单体与 `/api/*` facade，把前端从"单路由巨型客户端工作台"改成"Home 壳 + Workspace 壳 + 独立页面"。路由参数持有当前 Project 身份；页面只管理自己的交互状态；跨页面稳定能力下沉到 shared shell、shadcn/ui primitives 和 web-client。为 Home、History、Gallery、Provider 配置增加少量专用读/写契约，不改变 Generation/Session/History 列表只读以及 Provider adapter 并发能力。Generation Detail 以共享弹层实现，不占路由。

```text
Browser routes
├── /                                      HomeShell（顶部品牌条）→ Workspace Home
└── /workspace/[projectId]                 WorkspaceShell
    ├── /generate                          Generate（结果区 = poll 持有方之一）
    ├── /history                           History (read-only)
    ├── /gallery                           Gallery (global data)
    ├── /models                            Models (global preference)
    ├── /providers                         Provider catalog
    └── /providers/[providerId]             Provider configuration

共享弹层（无路由）
├── GenerationDetailDialog                 详情 poll 持有方之二
└── ImagePreviewDialog                     单图预览 + 信息卡
            │
            ▼
       src/lib/web-client
            │ same-origin HTTP
            ▼
       src/app/api → library / job-engine / provider-config service
```

## 2.2 设计决策表

| 决策项 | 选择 | 理由 | 放弃的选项 | 代价 |
|---|---|---|---|---|
| 页面导航 | App Router 真实路由 | 可深链、刷新、分包和独立生命周期 | 单页 `activeView` | 需要拆壳和迁移状态 |
| Workspace 身份 | URL `projectId` | 明确、可恢复、无需全局 store | localStorage 作为唯一真相 | URL 更长，需要 404/归属校验 |
| Session 身份 | Generate 页面内选择，最近值可按 Project 本地记忆 | Session 仅影响创作，不污染全局 | 所有页面顶部选择器 | 直达 Generate 时需选择/恢复 |
| 首个 Session | 新 Workspace 首次进 Generate 自动创建（name = `session-` + id 前 8 位） | 消除新用户空态阻塞 | 强制手动创建 | 页面挂载产生一次写副作用 |
| 共享状态 | Route + 页面查询；不引入 Redux/Zustand | 当前规模不需要新状态框架 | 全局客户端 store | 页面切换会重新查询部分数据 |
| UI primitives | shadcn/ui（Tailwind + Radix）源码复制进 `src/components/ui/` | 可访问性开箱即用、拥有代码、无运行时库锁定 | 手写全部 primitives、Ant Design/MUI | 引入 Tailwind 工具链 |
| 多语言 | 轻量 React context + 字典，默认中文 | 本地工具不需要 URL 级 i18n | next-intl 路由方案 | 所有文案必须 key 化 |
| 主题 | 不做明暗切换 | 用户明确不需要 | 保留 Light 开关 | 移除现有开关代码 |
| History 外层分页 | 服务端页码，每页 5 个非空 Session | 符合确认的用户模型，页码可定位 | 前端分组全部 generations | 新增聚合查询 |
| History 组内更多 | 复用 Generation cursor | 已有稳定只读契约 | offset 或全量返回 | 外层与内层有两种分页语义 |
| Gallery 过滤 | 服务端 project/provider filter + newest cursor | 跨分页结果正确 | 只过滤当前已加载图片 | API 增加查询参数和索引审视 |
| Provider 目录 | 固定七家 catalog + 配置摘要 + 官方申请 key 链接 | 与 adapter 能力一致，不伪造动态扩展 | Add provider | 增加 Provider 时需代码发布 |
| 密钥 API | 专用 provider-config service；DTO 只给摘要 | 隔离存储细节，未来可换 DB | 浏览器直接操作 user-config | 新增敏感写接口和并发保护 |
| 密钥清除 | UI 无 Clear 按钮；空输入 + Save 时调 DELETE | 一个 key 一个输入框，减少控件与确认弹窗 | 独立 Clear + ConfirmDialog | 需在 UI 层映射空值语义 |
| `.env` 覆盖 | source=`env` 时只读 | 保持现有 env > user-config | UI 覆盖 env | 用户需编辑 env 并重启 |
| 样式组织 | Tailwind（组件内）+ CSS Modules（页面布局）+ 全局 tokens | 缩小影响面又保留统一语言 | 单一 globals、运行时 UI 库 | 初期需整理现有选择器 |
| Generation Detail | 共享弹层（无路由） | 浏览历史/收藏不打断上下文；本地工具无需详情深链 | 独立路由页 | 刷新后弹层不恢复，需从列表重开 |
| Generation poll | Generate 结果区（当次提交）+ Detail 弹层（打开期间）两个持有方 | 与后端"仅详情 GET 推进"语义一致，且支持页内进度 | History 自动刷新每条详情 | 列表状态可能在下次自动刷新前略旧 |
| 列表刷新 | 进入页面 + 标签页重新可见时自动重取 | KISS，去除手动 Refresh | 手动按钮、定时轮询 | 极端情况下需手动 F5 |
| 成功反馈 | toast（sonner）仅用于结果不显而易见的成功操作；错误就地展示 | 明确反馈且不泛滥 | 全局 toast 一切、完全无提示 | 需约束使用边界 |

App Router 和专用读模型均为可逐页迁移的可逆选择。Provider 配置公开 DTO 不暴露存储细节是刻意的一扇门：后续实现不得把文件路径、加密 envelope 或 secret 加入浏览器契约。

### 2.1.1 交付顺序与视觉闸门

本批不把页面视觉实现与 API 变化并行推进。先交付后端契约及其测试，再交付无需最终样式的浏览器 API 接线；二者都完成并能用真实数据验证后，才开启一次单独的视觉讨论与 UI 实现批次。这样避免临时 DOM、全局 CSS 和设计系统初始化在数据模型仍变化时反复推倒。

| 顺序 | 交付 | 本批允许 | 明确延后 |
|---|---|---|---|
| 1 | Backend Contract | service、query、route、DTO、contract/integration test | 路由页面、最终样式 |
| 2 | Frontend API Wiring | `web-client`、请求状态/hook、auth gate、poll registry、client unit | Tailwind/shadcn、页面布局、视觉 CSS |
| 3 | Visual Decision Gate | 使用真实数据复核页面文档，冻结层级、密度、表面和禁用项；具体 accent hue 不做像素级冻结 | 代码式 UI 实现 |
| 4 | UI Implementation | 路由壳、页面组件、i18n、Tailwind/shadcn、CSS Modules、人工视觉 QA | — |

## 2.3 目标目录与职责

目标结构可在实现时做小幅命名调整，但职责不可重新合并回巨型组件：

```text
src/app/
├── page.tsx
├── home.module.css
├── workspace/[projectId]/
│   ├── layout.tsx
│   ├── error.tsx
│   ├── not-found.tsx
│   ├── generate/page.tsx
│   ├── history/page.tsx
│   ├── gallery/page.tsx
│   ├── models/page.tsx
│   └── providers/
│       ├── page.tsx
│       └── [providerId]/page.tsx
└── api/
    ├── project-summaries/route.ts
    ├── projects/[id]/history/route.ts
    ├── projects/[id]/sessions/initial/route.ts
    └── provider-configurations/
        ├── route.ts
        └── [providerId]/credential/route.ts

src/components/
├── shell/                       # HomeShell 顶部品牌条、WorkspaceShell 侧栏
├── ui/                          # shadcn/ui 源码复制型 primitives
├── dialogs/                     # GenerationDetailDialog、ImagePreviewDialog（跨页面）
├── i18n/                        # LocaleProvider、语言切换控件
├── home/
├── generate/
├── history/
├── gallery/
├── models/
└── providers/

src/lib/
├── web-client/
├── library/
├── provider-config/
├── i18n/                        # 字典（zh-CN / en）与 t() 实现
└── user-config/

根级新增：tailwind.config、postcss 配置（Tailwind v4 则为 CSS 入口配置）
```

`src/lib/provider-config/` 是浏览器用例的服务端 application service：组合固定 catalog、registry capability、model preference 与 user-config 摘要/写入；它不是新的 Provider adapter 层，也不拥有密钥存储。

## 2.4 状态所有权

| 状态 | 唯一真相 | 页面持有内容 | 不允许 |
|---|---|---|---|
| 当前 Workspace | route `projectId` + `GET /api/projects/:id` | shell 加载/错误状态 | 用 localStorage 替代 URL |
| 当前 Session | Session 实体；可用 `lastSession:<projectId>` 仅作建议值 | Generate 选择/创建/改名 | Gallery/Providers 依赖 Session |
| 界面语言 | localStorage `locale` + React context | 切换动作 | URL 语言段、服务端语言协商 |
| 模型启用偏好 | `/api/model-preferences` | Models 行级 saving/error | 多页面复制不同默认算法 |
| 当次选中模型 | Generate 页面内存 | targets | 写回全局 preference |
| 当前 generation 进度 | Detail DTO | 结果区/弹层的 poll controller、可见状态 | History/Gallery 调详情 GET |
| History page | URL search param `page` | 折叠状态、各组已加载 items | 全局 store |
| Gallery filter/cursor | URL search params + API response | 已加载 items、预览弹层状态 | 客户端过滤当前页伪装全库 |
| Provider credential draft | Provider Detail 内存 | 当前输入、可见开关 | localStorage、query、日志 |
| credential source | Provider config API 摘要 | 展示 | 返回 secret 或文件路径 |

异步页面请求必须使用 AbortController、request token 或等价机制，避免旧 route/filter 响应覆盖新状态。页面卸载时取消浏览器 fetch/timer，不等于取消后台 generation。

## 2.5 新增/调整 HTTP 契约

所有 route 沿用现有 same-origin 认证、错误处理和 JSON 规范。新列表接口全部只读，不调用 job-engine poll。

### 2.5.1 Workspace 摘要

`GET /api/project-summaries`

```ts
type ProjectSummary = {
  project: Project;
  sessionCount: number;
  generationCount: number;
  imageCount: number;
  lastActivityAt: string;
  coverImageUrl: string | null;
};
```

语义：按 `lastActivityAt DESC, project.id DESC` 返回全部 Project 摘要。`coverImageUrl` 取最近持久化图片；没有图片时为 `null`。这里不返回二进制或 provider 临时 URL。MVP 单用户预计 Project 数量有限，首批不分页；若未来增长再在同一 endpoint 加 cursor。

### 2.5.1a 首个 Session 的幂等建立

`POST /api/projects/:projectId/sessions/initial`

语义是 **ensure**，不是普通 create：若该 Project 已存在任意 Session，返回当前最近 Session；若不存在，在服务端临界区内创建唯一首个 Session，title 为 `session-<sessionId 前 8 位>`。创建返回 201，复用已有 Session 返回 200；两者 body 都是 `Session`。

Generate 不得先在浏览器执行“list 为空 → 普通 POST /sessions”的两步猜测。这样可抵抗双标签页、请求重试和开发模式 effect 重放；单进程本地 MVP 以 service 内按 Project 串行化实现，未来多进程部署再以数据库原子条件写替换。普通 `POST /api/projects/:projectId/sessions` 保持原有“明确创建新 Session”的语义。

### 2.5.2 History 聚合

`GET /api/projects/:projectId/history?page=1&sessionLimit=5&generationLimit=10`

```ts
type HistoryPage = {
  projectId: string;
  page: number;
  pageSize: 5;
  totalSessions: number;       // 仅统计有 generation 的 session
  totalPages: number;
  totals: {
    generations: number;
    images: number;
  };
  groups: Array<{
    session: Session;
    generationCount: number;
    imageCount: number;
    lastGenerationAt: string;
    items: GenerationSummary[];
    nextCursor: string | null;
  }>;
};
```

约束：

- 只选择至少有一个 Generation 的 Session。
- Session 顺序为 `lastGenerationAt DESC, session.id DESC`；同一查询内稳定。
- `page < 1`、limit 越界返回 400；不存在的 Project 返回 404；超出总页数返回空 groups 而不是 404。
- route 只读 DB，不调用 `job-engine.getGeneration`。
- 组内“加载更多”复用 `GET /api/generations?sessionId=:id&limit=10&cursor=:cursor`，同样只读。
- `sessionLimit` 和 `generationLimit` 服务端硬上限分别为 5 和 10；首批 UI 固定使用确认值，参数保留便于测试但不提供用户控件。

外层使用页码是产品确认，组内使用 cursor 是为了避免新 Generation 插入时 offset 重复/遗漏。用户翻页期间数据变化可导致 Session 跨页移动，这是实时列表允许的行为；不引入快照事务。

### 2.5.3 Generation Detail 归属

扩展 `GenerationView`：

```ts
type GenerationView = {
  // existing fields...
  projectId: string;
};
```

`GET /api/generations/:id` 仍是唯一可推进 poll 的读取。Detail 弹层从 History/Gallery 打开时，调用方已处于某个 Workspace 壳内；DTO 携带 `projectId` 使弹层能正确展示来源并在需要时校验归属（尤其 Gallery 为全局收藏，图片可能属于其他 Workspace）。弹层不做路由级 404，资源不存在时显示内联"记录不存在或已删除"状态。

同一 `generationId` 的多个可见入口不得各自轮询。浏览器侧新增按 generationId 的 transient poll registry：它只协调一个 detail GET 调度器和多个订阅者，最后一个订阅者卸载才停止；不存业务数据、不替代页面状态、也不引入 Redux/Zustand。结果区与 Detail 弹层仍是仅有的**订阅入口**。

### 2.5.4 Gallery 过滤

扩展现有：

`GET /api/favorites?limit=24&cursor=&projectId=&provider=&sort=newest`

约束：

- `projectId`、`provider` 均可省略；同时出现时为 AND。
- `sort` 首批只接受 `newest`，未知值返回 400。
- cursor 编码必须覆盖排序字段与稳定 tie-breaker；过滤条件改变后丢弃旧 cursor。
- 不存在的 Project 或未知 Provider 返回 400/404，具体错误形态与现有 API 约定统一。
- 响应仍为 `Page<GalleryItem>`，其中 `projectId/projectTitle/provider` 是展示与深链来源。

### 2.5.5 Provider 配置摘要

`GET /api/provider-configurations`

```ts
type CredentialSource = 'env' | 'user-config' | 'none';

type ProviderConfiguration = {
  providerId: ProviderId;
  displayName: string;
  credentialName: ProviderCredentialName;
  configured: boolean;
  source: CredentialSource;
  models: ProviderCapabilities[];
  enabledModelCount: number;
  availableModelCount: number;
  editable: boolean; // false when source === 'env'
  keyApplyUrl: string; // 官方申请 API key 的 https 链接；catalog 静态策展，实施时逐家核实
};
```

固定返回七家，按 Provider catalog 顺序。不得返回：secret、masked secret 片段、加密文件路径、last checked、connected、余额或远端 health。`configured` 表示 `source !== 'none'`。`keyApplyUrl` 是固定 catalog 数据，不是运行时探测结果。

### 2.5.6 Provider credential 写入

`PUT /api/provider-configurations/:providerId/credential`

```json
{ "value": "new-secret" }
```

成功返回该 Provider 的 `ProviderConfiguration` 摘要。服务端从固定 catalog 得到 credential name，客户端不得提交任意 env key 名。要求：

- trim 后空值或超长值返回 400；建议上限 16 KiB。
- source 为 env 时返回 409 `CREDENTIAL_MANAGED_BY_ENV`，不可覆盖。
- 缺 `USER_CONFIG_ENCRYPTION_KEY` 返回可行动的 503/配置错误，不含输入值。
- 写入流程在进程内串行：读取整个 credential map → 合并单 key → 原子写回，防止并发保存不同 Provider 时丢更新。
- 成功后清理/刷新 registry 的凭证派生缓存（若实现存在缓存）；adapter 仍在实际调用时解析凭证。
- request body、日志、异常 cause、监控和响应均不得记录 value。

`DELETE /api/provider-configurations/:providerId/credential`

- 只删除 user-config 中对应 key，保留其他 key。
- source 为 env 返回 409，不删除 env。
- 未配置时幂等返回当前摘要或 204；实现阶段统一一种并写 contract test。
- UI 不暴露独立 Clear 按钮：用户在输入框清空内容后点 Save，前端将其映射为 DELETE 调用；未配置时空输入点 Save 则就地提示“请输入 API key”，不发请求。保存/清除成功后 toast 提示并重新拉取摘要。

### 2.5.7 认证与错误响应边界

保持现有可选 `APP_AUTH_TOKEN` 的 cookie 登录门：`GET/POST /api/auth/session` 继续是唯一公开的认证协商入口，其他 API 沿用 middleware 保护。Backend Contract 与 Frontend API Wiring 阶段不得让 Server Component/layout 直接读取受保护的 Project、Provider 或 credential 数据；路由壳先显示结构，客户端完成 auth session 检查后才调用数据 API。是否将页面 URL 也升级为 middleware 保护属于后续独立安全决策，不在本批隐式改变。

所有新增及本批修改的失败响应统一为：

```ts
type ApiErrorBody = {
  error: { code: string; message: string; retryable: boolean };
};
```

至少为 `CREDENTIAL_MANAGED_BY_ENV`、`INITIAL_SESSION_UNAVAILABLE`、validation、not-found、authentication、configuration-unavailable 定义稳定 code；message 不含 secret。`ApiClientError` 相应增加 `code` 与 `retryable`，前端不得解析自由文本判断状态。

## 2.6 页面架构与数据流

### 2.6.1 Home

视觉实现阶段的 Home 通过浏览器 API 获取 Project summaries，Client island 管理 Create Workspace 表单。这样在 `APP_AUTH_TOKEN` 启用时不会由 Server/Page 层绕过现有登录门读取数据。点击最近 Workspace 进入其 Generate 路由；创建成功直接进入新 Workspace 的 Generate，Session 由 Generate 首次引导自动创建。顶部品牌条右侧放语言切换。

### 2.6.2 Workspace Shell

layout 只渲染不含业务数据的结构；客户端在 auth gate 成功后读取 Project 并渲染 workspace title、返回入口与五个主导航项。侧栏底部放语言切换（无主题开关）。壳不读取 Session、Generation、Provider 密钥或 Gallery；页面数据失败不应让整个壳消失。移动端改为顶部栏 + 可关闭抽屉。

### 2.6.3 Generate 与 Generation Detail 弹层

Generate 加载 Sessions（无 Session 时自动创建首个并选中）、Provider capabilities、Model Preferences；提交后不跳转，在 composer 下方结果区内嵌展示当次 generation 的各 Provider 进度与图片，结果区持有该 generation 的详情 poll；生成中 Generate 按钮直接变身 Cancel（调已有 cancel route）。

GenerationDetailDialog 从 History 行与 Gallery 预览弹层打开：挂载时调用详情 GET，非终态启动受控轮询；终态、关闭弹层或不可重试错误时停止。进行中的任务在弹层内也提供 Cancel。任何时刻只开一个弹层：从预览弹层进入 Detail 时先关预览。

### 2.6.4 History / Gallery

History 只调用聚合 read endpoint 与通用只读 generation list；进入页面与标签页重新可见时自动重取，无手动 Refresh、无定时轮询。Gallery 只调用 Favorite list/add/remove；点击图片打开预览弹层（其中"查看生成详情"链接再开 Detail 弹层），不在列表预取详情 GET。

### 2.6.5 Models / Providers

Models 通过 Provider configuration/capabilities + Model Preferences 组成全局模型表，但首批只展示 `configured=true` Provider 的已知模型；未配置 Provider 的模型目录和配置入口由 Providers 承担，Models 页头给轻提示。搜索/Provider 筛选只在已取回的固定集合上客户端执行。Providers 使用 configuration summary；详情写 credential 后重新取摘要并 toast 提示，不尝试远端 provider 调用。

## 2.7 分阶段实施

状态说明：Phase 1（Backend Contract）与 Phase 2（Frontend API Wiring）已在 `mvp` 完成；Visual Decision Gate 已由第三轮 ASCII 排版讨论通过。以下 Phase 3–6 是下一阶段 UI 实施顺序。

### Phase 1：Backend Contract 与数据读模型

目标：在不改页面结构或视觉 CSS 的前提下，补齐行为所需的 server-side query/service/route/DTO，并用 contract/integration 测试封住只读、并发、安全和错误语义。

改动：

- `src/lib/library/`、`src/lib/db/queries/`：Project summary、History 聚合、Gallery 过滤与有界缩略图摘要。
- `src/lib/provider-config/`：固定 catalog、credential source 摘要、申请 key URL allowlist、读写编排。
- `src/lib/library/sessions.ts`：按 Project 幂等的 `ensureInitialSession`。
- `src/app/api/`：summary/history/initial-session/provider-config routes、favorites/detail DTO 扩展和统一错误 DTO。
- contract/unit/integration：分页与 cursor、只读不 poll、初始 Session 并发、provider secret allowlist、env 409、错误 code。

DoD：新增接口可被 typed client 消费；没有 UI 直接导入 server module；History/list 仍不推进 poll；Gallery 过滤跨 cursor 正确；首个 Session 不重复；任何 credential 响应/错误不含 secret。对应验收 B01–B09、E01–E11、E16。

### Phase 2：Frontend API Wiring 与行为基础

目标：把 Phase 1 的契约接入浏览器 typed client、auth gate、页面数据状态与轮询协调，但不创建最终页面 DOM、设计系统或视觉样式。

改动：

- `src/lib/web-client/types.ts`、`api-client.ts`：新增 DTO、错误字段与请求方法。
- `src/lib/web-client/`：request cancellation、页面 query state helper、按 generationId 去重的 poll registry 及 unit tests。
- 复用既有 `auth/session` 行为的 client auth gate；在本阶段不改变 middleware 对页面 URL 的保护范围。
- 行为测试与最小非视觉 harness（如有必要）只验证 API 接线，不成为生产页面或临时设计系统。

DoD：新 API 有完整 typed client；401、409、400、404、503 能以 code 驱动恢复状态；同一 Generation 至多一个 detail poll 调度器；关闭最后订阅者会停止浏览器轮询。对应 C02、C06–C07，以及 C08–C09 的 API/轮询基础；Detail 弹层、可见 Cancel 入口与其页面验收留待 Phase 3。

### Visual Decision Gate（文档已完成，不写 UI 代码）

使用 Phase 1–2 的真实数据与错误状态，逐页确认信息密度、布局、移动端收纳、空/错状态与中英文扩张。本闸门现已通过第三轮排版讨论完成：结构、尺寸区间、按钮/表面规则与视觉禁区已写入 `03`、`shared/01` 和各页面 `01`。具体 accent hue、灰阶冷暖与细节节奏刻意留给首个视觉实现提交校准，不构成实施阻塞。

### Phase 3：Home、Generate 与 Detail 弹层纵切（视觉确认后）

目标：在视觉确认后，把创作主路径迁移到真实路由，落地 Home/Workspace 两种壳与 Detail 弹层。

改动：

- Tailwind/PostCSS、shadcn/ui、locale context/dictionaries、`src/components/shell/`、`ui/`、`i18n/`。
- `src/app/page.tsx`、`src/app/workspace/[projectId]/layout.tsx` 与 Generate 页面。
- `src/components/home/`、`generate/`、`dialogs/`。
- 对应 app pages 与 CSS Modules。
- `GenerationView.projectId` 和必要 API/测试调整。
- Session 自动创建与改名（复用已有 `PATCH /api/sessions/:id`）。

DoD：选择/创建 Workspace → 自动获得首个 Session → 多模型提交 → 结果区内嵌进度/变身 Cancel → Detail 弹层轮询/取消/收藏 → 结果图单图预览完整可走；仅结果区与弹层订阅 detail poll。对应 A01–A07、C01–C11。

视觉基础按以下顺序落地，避免新旧 CSS 长期并存：

1. 在 `globals.css` 建立语义 tokens、reset 与 Tailwind 入口，先不复制旧页面规则。
2. 以 shadcn 默认 primitives 为可访问性基线，映射本项目 tokens；Button/Input 使用圆角矩形，不做全 pill 化。
3. 先完成 HomeShell、WorkspaceShell 和 Home/Generate 页面 CSS Modules，验证 248px 侧栏、320–360px inspector 与中英文排版。
4. 再按 History/Gallery → Models/Providers/Provider Detail 的纵切顺序迁移页面布局。
5. 每迁移一页即删除该页旧全局选择器；最终 `globals.css` 不保留页面私有 grid、卡片阴影体系、重复参数区或旧三栏壳规则。

### Phase 4：History 与 Gallery 纵切（视觉确认后）

目标：完成两类图片资产浏览页面。

改动：

- `src/components/history/`、`gallery/`。
- 对应 pages、查询参数同步与样式。
- Gallery 预览弹层与 Detail 弹层的串联（一次只开一个）。

DoD：History 5 组/页、10 条/组、批次缩略图条、组折叠默认最新展开；Gallery 顶部筛选、Load more、预览信息卡；空/错/加载状态完整；自动刷新无手动按钮。对应 D01–D11。

### Phase 5：Models、Providers 与安全密钥纵切（视觉确认后）

目标：完成模型启用与 Provider 配置。

改动：

- `src/lib/provider-config/`（含各家官方申请 key 链接的 catalog 数据）。
- `src/app/api/provider-configurations/`。
- `src/components/models/`、`providers/`。
- `src/lib/user-config/` 只补安全服务能力和并发测试，不改变加密格式。

DoD：固定七家；开关真实持久化；env 只读；user-config 可保存/替换/空值清除；成功 toast、失败就地；任何响应和日志无 secret；并发写不丢其他 key。对应 E01–E15。

### Phase 6：删除旧壳、视觉收口与权威文档同步

目标：移除双实现和全局样式债务，完成发布门。

改动：

- 删除或拆尽 `src/components/generate-workbench.tsx`、`library-pages.tsx`。
- 删除失效全局选择器与主题切换残留，保留 tokens/reset/真正全局规则。
- 更新 `docs/mvp/web-ui/`、`api/constraints.md`、`user-config/`、`library/`、`web-client/`。

DoD：无 `activeView` 页面导航；无重复 Workspace 卡；未引用死 CSS；无明暗切换入口；中英字典完整；所有测试、构建、浏览器 QA 通过。对应 F01–F10。

## 2.8 按目录的改动面

| 目录 | 新增 | 修改 | 删除/收缩 |
|---|---|---|---|
| `src/app/workspace/[projectId]/` | layout、6 类页面、error/not-found | — | — |
| `src/app/api/` | summaries/history/provider-config routes | favorites/detail DTO | — |
| `src/components/shell/`、`ui/` | 壳与 shadcn/ui primitives | — | — |
| `src/components/dialogs/`、`i18n/` | Generation Detail/图片预览弹层、语言切换 | — | — |
| `src/components/<page>/` | 7 页局部组件 | — | — |
| `src/components/` 根 | — | — | 旧 workbench/library 聚合组件、主题开关 |
| `src/lib/web-client/` | 新 DTO/client methods | types/api-client | 不保留旧 view-state helper |
| `src/lib/i18n/` | zh-CN / en 字典与 t() | — | — |
| `src/lib/library/`、`db/queries/` | summary/history/filter queries | 导出与测试 | — |
| `src/lib/provider-config/` | catalog application service（含申请链接） | — | — |
| `src/lib/user-config/` | merge/remove/serialization 能力（如需要） | tests | 不改 envelope v1 |
| `src/app/globals.css` | tokens/reset/Tailwind 入口 | 逐步收缩 | 页面专属全局规则 |
| 根配置 | tailwind/postcss 配置、shadcn components.json | — | — |
| `tests/` | contract/integration | factories | — |

## 2.9 兼容、迁移与回滚

### 2.9.1 数据兼容

- 不新增业务数据库实体，不需要 schema migration。
- 现有 Project/Session/Generation/Favorite/Model Preference ID 和数据保持不变。
- user-config encrypted envelope 继续 version 1，不进行凭证迁移。
- 新 DTO 以加字段或新 endpoint 为主；现有 API 消费者可继续工作。

### 2.9.2 URL 兼容

旧系统只有 `/`，没有可兼容的子页面 URL。发布时 `/` 直接变为 Home。可选择暂时接受 `?view=` 并 redirect 到新路由，但不是必须；不得长期维护两套路由状态。

### 2.9.3 分阶段回滚

- Phase 1 的纯读 endpoint 与 Phase 2 client 接线可按 route/module 单独回滚；不会迁移现有业务 schema。
- Phase 1 的 ensure-initial 可能创建一个真实默认 Session，Provider 配置写入可能创建或更新真实加密 user-config；代码回滚不删除这些用户数据。
- Phase 3 起保留 git 级纵切提交，出现问题可回退单页面而不恢复 user secret。
- Provider 配置写入落地后，旧 registry 仍能读取已加密 user-config。
- 不使用 feature flag 长期维持新旧 UI；本地单用户 MVP 以清晰提交边界替代运行时双轨。

## 2.10 风险与防御

| 风险 | 防御 | 残余风险 |
|---|---|---|
| History 聚合 N+1 | DB 层聚合/批量查询，integration 验证 query 行为 | 极大库仍可能需要后续索引/性能测量 |
| Gallery 过滤后 cursor 串用 | cursor 与 filter 一起重置；服务端验证 | 用户快速切换仍需取消陈旧响应 |
| 并发保存 key 丢其他 Provider | 进程内串行 merge-write + 原子 rename | 多进程并发不在本地 MVP 范围；文档明确 |
| secret 泄漏到响应/日志 | allowlist DTO、专用错误、测试用 canary secret 全局扫描 | 浏览器扩展/本机权限不由应用防护 |
| env/user-config 状态误导 | source 明确，env editable=false，无 Connected | 实际 provider 可用性仍需一次真实生成验证 |
| 页面离开后轮询泄漏 | 结果区/弹层各自持有 + cleanup/abort | 后台 worker 可继续推进，这是预期行为 |
| 弹层状态与列表不一致 | 弹层写操作（收藏/取消）成功后回调列表局部更新 | 跨弹层并发操作同一条目靠服务端最终状态校正 |
| 空输入误清除 key | 空值保存即 DELETE 的语义在输入框旁以辅助文案说明 | 用户手动清空后误点保存仍可能删 key，靠 toast 反馈可发现 |
| 申请 key 链接失效 | URL 作为 catalog 静态数据，实施时逐家人工核实 | 厂商后续改版需代码更新 |
| i18n 漏 key | 字典完整性单测（zh/en key 集合一致）+ 文案抽查 | 长文案排版溢出靠视觉 QA |
| CSS 拆分视觉漂移 | tokens + shadcn primitives + 页面视觉 QA | 不做脆弱的像素快照 |

## 2.11 与 `00` 的边界对齐

- 已包含七个路由页面、两种导航壳、Generation Detail 共享弹层、History 双层分页、Gallery 全局范围、Models Switch、Provider 安全配置和申请 key 链接。
- 已明确 Kling 独立凭证、env 只读、七家固定目录、无 Add provider、无虚假健康字段。
- 已保持单用户、模块化单体、高并发 generation fanout 与只读列表约束。
- 已纳入 shadcn/ui + Tailwind、默认中文 i18n；明确不做明暗切换。
- 未加入多用户、动态 Provider、数据库密钥、真实 provider probe、Settings 或高级过滤。

## 2.12 本批不实施的后续事项

1. Provider key 迁入 DB、多用户 secret ownership、OS keychain。
2. Provider remote health/余额/模型自动发现。
3. History/Gallery 全文搜索和复杂过滤。
4. Gallery 批量下载、相册、标签编辑。
5. Model 自定义注册、批量开关、价格信息。
6. 明暗主题切换、品牌配置、URL 级多语言路由和独立设计系统包。
7. WebSocket/SSE 实时状态；现阶段保留结果区/弹层 polling 与后台 worker。
8. 图片预览弹层的左右切换与复杂 lightbox。
