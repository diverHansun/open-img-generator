# Web UI 多页面重构 · improve-1

> 状态：产品、契约与视觉排版文档已收敛，待 UI 实施<br>
> 日期：2026-07-19（视觉排版决策见 `00-discussion.md` §0.11）<br>
> 文档落点：`docs/mvp/web-ui/frontend-overhaul/improve-1/`<br>
> 实施状态：**Backend Contract 与 Frontend API Wiring 已在 `mvp` 落地；本轮视觉文档已收敛，页面 UI 尚未实施**

## 1. 本批目标

把当前由一个巨型客户端组件承载的 Generate、History、Gallery、Models、Providers 视图，重构为具有真实路由、独立职责、独立状态与独立页面样式的多页面 Web UI。

本批同时建立一套"共享设计基础 + 页面独立设计"的文档体系：共享层统一导航壳、设计变量、基础控件（基于 shadcn/ui + Tailwind CSS）、响应式与可访问性、多语言；各页面只描述自己的布局、交互、组件组合、数据契约、用例与验收标准，避免把当前单文件耦合改造成多份重复 CSS。

实施顺序明确分离行为与表现：先完成后端补充与 HTTP 契约，再完成浏览器 typed client、鉴权门和轮询等 API 接线；最终页面布局、Tailwind/shadcn 落地与视觉 CSS 必须等真实数据可用、经单独视觉讨论确认后才实施。页面视觉文档在此之前是方向与边界，不是逐像素施工稿。

成功标准：

1. `/` 成为 Workspace 选择与创建首页，启动开发服务后首先进入该页面。
2. 进入 Workspace 后不再在每个页面重复 Project/Session 选择卡片；侧边栏以 `← Workspaces` 返回首页。
3. Generate、History、Gallery、Models、Providers、Provider Detail 有独立路由和页面边界；Generate 以同路由 Compose/Stage 管理唯一当前任务，Generation Detail 以共享卡片弹层呈现（无独立路由），与可见的 Generate Stage 共同构成仅有的两个 poll 持有方。
4. History 按当前 Workspace 下"每页 5 个非空 Session、每个 Session 首批 10 条 Generation、组内继续加载"组织；列表保持只读。
5. Gallery 保持全局收藏；图片无常驻标签，来源信息在预览弹层右侧信息卡展示。
6. Models 使用真实语义的启用开关；Providers 展示固定 Provider 目录并允许进入详情配置密钥，catalog 含各家官方申请 key 链接。
7. `.env` 凭证来源只读；浏览器永不读取已保存密钥明文，小眼睛只显示当前新输入。
8. 视觉层级统一、减少无意义卡片与阴影；采用清爽克制的亮色工具界面、单一纯色强调色与明确语义色，不把陶土色或蓝紫渐变固定为品牌主色。
9. UI 默认中文，可切换英文；不做明暗主题切换。

## 2. 已确认的产品决策

| 议题 | improve-1 决策 |
|---|---|
| 页面组织 | 使用 Next.js 真实路由，每个页面独立设计与实现 |
| UI 组件基础 | shadcn/ui（Tailwind CSS + Radix UI，源码复制型）做 primitives；页面布局用 CSS Modules；禁止运行时组件库 |
| 多语言 | 默认中文，可切换英文；轻量 context + 字典方案，语言偏好存 localStorage |
| 主题 | 不做明暗切换，移除现有主题开关 |
| 首页 | 借鉴 OpenDesign 的大留白、中心任务和最近项目区域，但不复制 Prompt/模板业务 |
| 首页导航 | 使用顶部品牌条（非左侧 Rail），右侧放语言切换 |
| Workspace 内导航 | 使用完整侧边栏；不提供 Home 导航项；提供明确的 `← Workspaces` 返回入口；侧栏底部放语言切换 |
| History | 隐藏没有 Generation 的空 Session；每页 5 个 Session；每组首批 10 条并可继续加载；行内展示批次缩略图 |
| Gallery | 全局收藏；无常驻标签；第一批过滤范围受控（顶部筛选条） |
| Providers | 固定展示七家 Provider；不提供 Add provider；不伪造 Connected 或 Last checked；catalog 含官方申请 key 链接 |
| Provider 密钥 | `.env` 来源只读；用户配置写入现有加密 user-config；未来数据库存储不改变前端契约 |
| Generate | Compose/Stage 互斥；Stage 隐藏 Inspector、只展示当前 Generation；返回 Compose 暂停详情 poll，点击“当前任务”恢复 |
| Generation 详情 | 共享卡片弹层（无独立路由）；从 History 行 / Gallery 预览进入；与可见 Generate Stage 互为仅有的 poll 持有方 |
| Settings | 未定义前从导航移除，不保留 disabled 占位 |
| 参考图 | 只作为布局、信息密度和视觉语言的输入，不是最终稿或逐像素实现目标 |
| 视觉自由度 | 固定层级、密度、表面与禁用项；具体 accent hue、灰阶冷暖和细节比例由首个视觉实现提交用真实页面校准 |

## 3. 页面与数据作用域

UI 统一使用 **Workspace**；现有数据库、library 与 HTTP API 继续使用 **Project**。本批不做底层领域名重命名。

| 页面 | 目标路由 | 页面作用域 | 数据作用域 |
|---|---|---|---|
| Workspace Home | `/` | 全局入口 | 全部 Project/Workspace |
| Generate | `/workspace/:projectId/generate` | 当前 Workspace | 当前 Project + 当前 Session |
| History | `/workspace/:projectId/history` | 当前 Workspace | 当前 Project 下非空 Session 与 Generation，只读列表 |
| Gallery | `/workspace/:projectId/gallery` | 当前 Workspace 导航壳 | 全局 Favorite Image；来源信息在预览弹层展示 |
| Models | `/workspace/:projectId/models` | 当前 Workspace 导航壳 | 全局 Provider Model Preference |
| Providers | `/workspace/:projectId/providers` | 当前 Workspace 导航壳 | 固定 Provider 目录与凭证配置摘要 |
| Provider Detail | `/workspace/:projectId/providers/:providerId` | 当前 Workspace 导航壳 | 单 Provider 配置与能力摘要 |

Generate 的可选 `?generation=:id` 只表示该路由当前打开 Stage；省略时为 Compose。它不是新的页面，也不把 active generation 写入 localStorage。

Generation Detail 不是路由页面，而是共享弹层组件（见 `shared/07-generation-detail-dialog.md`）：从 History 行与 Gallery 预览弹层进入，打开期间持有该 Generation 的详情 poll，关闭即停止。Generate 的 `Stage` 是另一个 poll 持有方（仅针对唯一 current task，Compose 不持有隐藏 poll）。

`projectId` 对 Gallery、Models、Providers 表示“当前导航上下文”，不把这些全局数据错误过滤成项目级数据。这样可以保留一致侧边栏、明确返回路径和可刷新的深链接，而不依赖一个巨型组件内的 `activeView` 状态。

## 4. improve-1 范围

### 4.1 In scope

- 页面路由、App Shell、Workspace 上下文和返回首页流程。
- Home、Generate、History、Gallery、Models、Providers、Provider Detail 的目标设计文档，以及 Generation Detail 共享弹层设计。
- shadcn/ui + Tailwind CSS 的引入与 primitives 落地；页面布局 CSS Modules；tokens 统一出口。
- 多语言（默认中文 / 可切英文）的轻量方案与全量文案 key 化。
- Generate 中重复参数控件、Provider 状态卡片和 Workspace 卡片的重新归位；Compose/Stage 分离，Stage 图片优先且只含当前 Generation Job 明细。
- History 的 Session 分页与组内 Generation cursor 契约设计；行内批次缩略图。
- Gallery 的顶部筛选条、Newest 排序、继续加载与图片预览弹层（右侧信息卡）设计。
- Models 的客户端搜索、Provider 筛选、能力展开和启用 Switch。
- 固定 Provider catalog（含官方申请 key 链接）、配置来源摘要、用户密钥 Save（空值即 Clear）的安全接口设计。
- CSS variables、页面 CSS Module、共享组件和响应式/可访问性规范。
- 为上述 UI 所必需的 API/DTO 调整，以及相应测试与验收标准。
- 标注并规划更新既有 `web-ui`、`api`、`user-config` 权威文档中的冲突段落。

### 4.2 Out of scope

- 本规划会话内的 React、CSS、API、数据库或测试代码实施。
- 把 Provider API key 迁入业务数据库；本批仅保持未来可替换的服务端边界。
- 动态添加未知 Provider；Provider catalog 仍是代码内固定的七家。
- 对 Provider 发起真实“连接测试”或伪造健康时间；没有真实探测能力时只显示 Configured/Not configured。
- 多用户、组织、团队、SaaS 权限或云端密钥同步。
- 改变“Generation/Session/History 列表只读，只有详情 GET（`GET /api/generations/:id`）可推进 poll”的后端约束。
- History 全文搜索、时间/Provider 高级筛选；可记录为后续批次。
- Gallery 全文搜索、下载管理、复杂图片方向筛选；可记录为后续批次。
- 尚未定义职责的 Settings 页面、明暗主题切换与完整设计系统包。
- 逐像素复制参考图、引入运行时组件库（Ant Design / MUI 等）或 Masonry 第三方运行时。shadcn/ui 为源码复制型方案，不在此限。

## 5. 文档地图

### 5.1 根级改造文档（必须按顺序阅读）

| 顺序 | 文档 | 职责 | 状态 |
|---|---|---|---|
| 1 | `README.md` | 范围、页面地图、阅读顺序、实施边界 | 已完成 |
| 2 | `00-discussion.md` | 当前对话中已确认的产品与设计决策 | 已完成 |
| 3 | `01-problem-analysis-and-current-state.md` | 对现有代码、页面、样式、接口与文档的证据化诊断 | 已完成 |
| 4 | `02-optimization-plan-and-change-scope.md` | 后续实施阶段、文件/路由/API 改动面、兼容与回滚 | 已完成 |
| 5 | `03-reference-screens-and-visual-direction.md` | 五张参考图的可借鉴点、禁用照抄项与视觉方向 | 已完成 |
| 6 | `04-test-and-acceptance.md` | 跨页面测试策略、关键风险与总体验收门槛 | 已完成 |

根级 `02` 与 `04` 是实施执行契约；Phase 1–2 已落地，下一阶段按这些文档实施页面 UI。

### 5.2 共享设计文档

共享文档位于 `shared/`：

1. `01-design-language-and-css-tokens.md`
2. `02-app-shell-navigation-and-routing.md`
3. `03-shared-components.md`
4. `04-responsive-and-accessibility.md`
5. `05-state-and-data-boundaries.md`
6. `06-i18n.md`
7. `07-generation-detail-dialog.md`

共享文档只定义跨两个及以上页面真正共用的规则。页面特有布局和状态不得为了“复用”被强塞进共享层。

### 5.3 页面独立文档

页面文档位于 `pages/`：

```text
pages/
├── home/
├── generate/
├── history/
├── gallery/
├── models/
├── providers/
└── provider-detail/
```

Generation Detail 不再是页面，其设计集中在 `shared/07-generation-detail-dialog.md`。

每个页面目录使用相同的文档骨架：

```text
README.md
01-ui-layout-and-style.md
02-interaction-and-states.md
03-components.md
04-data-and-api.md
05-use-cases.md
06-test-and-acceptance.md
```

页面文档只描述该页面自己的职责与差异；颜色、间距、按钮、输入框、侧边栏、断点和通用状态样式应引用 `shared/`，不逐页复制。

## 6. 第一批过滤与控件边界

| 页面 | improve-1 包含 | 明确后置 |
|---|---|---|
| Models | 客户端模型搜索、Provider 筛选、能力展开、启用 Switch、未配置 Provider 页头提示 | 服务端全文搜索、批量编辑 |
| History | Session 页码分页、组内加载更多、批次缩略图条、组折叠、只读状态展示、自动刷新 | Prompt 全文搜索、时间和 Provider 高级筛选 |
| Gallery | 顶部 Workspace/Provider 筛选条、Newest 排序、Load more、图片预览弹层 | 全文搜索、下载管理、复杂方向筛选 |
| Providers | 固定目录、配置来源、申请 key 链接、进入详情、自动刷新摘要 | Add provider、虚假连接状态、真实厂商探测 |

任何过滤只要跨 cursor/分页，就必须由服务端查询保证全量正确；不得只过滤客户端已加载的一页并伪装成全库结果。

## 7. 安全与只读约束

1. `.env` 凭证来源只读，并继续拥有最高解析优先级。
2. Provider Detail 不回显已保存密钥；配置状态只返回 `configured` 与 `source` 等非秘密摘要。
3. 小眼睛只在本地切换当前新输入的 `password/text`，保存成功后立即清空输入。
4. 用户配置通过受认证的 same-origin API 写入现有加密 user-config；日志、错误、响应和测试快照不得包含密钥。
5. 后续迁移到数据库时，UI 与公开 DTO 不依赖具体存储介质；本批不预先设计多用户密钥表。
6. History、Gallery 和 Generation 列表继续只读；只有两个 UI 单元可调用 `GET /api/generations/:id` 推进异步任务：可见的 Generate Stage（唯一 current task）与 Generation Detail 弹层（打开期间）。Compose 的“当前任务”入口不轮询。

## 8. 与既有文档的关系

当前 `docs/mvp/web-ui/*.md`、`docs/mvp/api/constraints.md` 和 `docs/mvp/user-config/*.md` 仍描述现有运行时，其中包含“单页 view state”“Provider key 只读且无浏览器写接口”等已被本议题重新讨论的边界。

在本套文档完整确认前，不静默改写这些权威文档。`02-optimization-plan-and-change-scope.md` 将列出必须同步更新的章节；实施完成并通过 `04-test-and-acceptance.md` 后，再把已落地目标回写为新的权威运行时说明。

## 9. 规划与实施闸门

本目录按以下阶段推进：

1. 根级 `00`–`04`、`shared/` 与七个页面文档集已完成三轮收敛（视觉排版见 `00-discussion.md` §0.11）。
2. Backend Contract 与 Frontend API Wiring 已分批落地并提交；页面 UI 仍保持现状。
3. Visual Decision Gate 已冻结结构、密度、表面、组件和禁用项；具体 palette 细节留给首个视觉提交校准。
4. 下一阶段按根级 `02` 的 Phase 3–6 实施 App Shell、页面、Tailwind/shadcn、CSS Modules 与 i18n，并按根级 `04` 和页面级 `06` 验收。
5. 页面实施完成后同步改写既有权威运行时文档；未落地部分仍不得写成现有运行时事实。
