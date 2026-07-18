# 0. 讨论记录与已确认要点

> 讨论定稿日期：2026-07-17；文档逐页收敛：2026-07-18<br>
> 本文只冻结已经确认的结论；问题证据见 `01`，实施方案见 `02`。

## 0.1 背景与动机

当前前端已经把 Generate、History、Gallery、Models、Providers 的初始功能接到后端，但仍以一个页面内的视图切换为主。每个视图重复出现 Workspace 选择，页面由大量卡片堆叠，非 Generate 页面还继承了为 Generate 准备的三栏壳。用户希望先把页面职责、数据契约和视觉语言写清楚，再进行全面前端优化，避免继续在巨型组件中叠加状态和样式。

## 0.2 已确认：目标与产品边界

| 决策项 | 已确认结论 |
|---|---|
| 页面边界 | 每个主要功能使用独立 Next.js 路由和独立页面实现，不再依靠 `activeView` 在单个客户端组件内切换 |
| UI 组件基础 | shadcn/ui（Tailwind CSS + Radix UI，源码复制进 `src/components/ui/`）做 primitives；页面布局用 CSS Modules；不引入运行时组件库 |
| 多语言 | 默认中文、可切换英文；轻量 React context + 字典；语言偏好存 localStorage；不引入 next-intl 路由方案 |
| 主题 | 不做明暗切换，移除现有主题开关 |
| Workspace 首页 | `npm run dev` 后进入 `/`；首页用于选择或创建 Workspace（底层仍称 Project） |
| 首页外观 | 借鉴 OpenDesign 的大留白、中心主任务区和最近 Workspace；不复制其 Prompt/模板业务 |
| 导航壳 | 首页使用顶部品牌条（右侧放语言切换）；进入 Workspace 后使用完整侧边栏（底部放语言切换） |
| 返回首页 | Workspace 侧边栏不放 Home 菜单，顶部提供 `← Workspaces` 返回 `/` |
| 页面清单 | Home、Generate、History、Gallery、Models、Providers、Provider Detail 七个路由页面；Generation Detail 为共享卡片弹层（无路由） |
| Workspace 选择 | 从各功能页面移除重复的 Project 选择卡；Workspace 由路由参数 `projectId` 确定 |
| Session 选择 | Session 是 Generate 的创作上下文，不再出现在 Gallery、Models、Providers 等无关页面 |
| Session 创建 | 新 Workspace 首次进入 Generate 时自动创建首个 Session；初始 name = `session-` + id 前 8 位 |
| Session 改名 | name 可由用户修改（id 为完整 UUID 永不变）；入口在 Generate Session 横条；复用已有 `PATCH /api/sessions/:id` |
| History | 只显示当前 Workspace 内含 Generation 的 Session；每页 5 个 Session，每组首批 10 条 Generation，并支持组内加载更多；行内展示批次缩略图条；组可折叠（默认最新一组展开） |
| History 读语义 | History、Session、Generation 列表全部只读，不推进异步任务 |
| Generation Detail | 共享卡片弹层；从 History 行与 Gallery 预览弹层进入；打开期间持有详情 poll，关闭即停 |
| Generate 提交 | 提交后不跳转，进度与结果内嵌在 Prompt composer 下方的结果区；Generate 按钮在生成中直接变身 Cancel |
| Cancel | 只有 Generate composer（当次提交）与 Detail 弹层（进行中的任务）两处提供；同一时刻只有一个可见；离开页面不取消任务 |
| Gallery | 保持全局收藏，不按当前 Workspace 强制裁剪；图片无常驻标签；Workspace 等信息在预览弹层右侧信息卡展示 |
| Gallery 首批过滤 | 顶部筛选条（Workspace、Provider 下拉）；排序固定 Newest 无控件；Load more；跨分页过滤必须由服务端完成 |
| 图片预览 | 点击图片打开预览弹层（左图 + 右侧信息卡 + “查看生成详情”链接）；第一批只做单张大图 + 关闭，不做左右切换；任何时刻只开一个弹层 |
| Models | 按 Provider 分组，支持客户端搜索、Provider 筛选、能力展开和真实启用 Switch；未配置 Provider 不显示但页头给轻提示 |
| Providers | 固定七家目录；不提供 Add provider；不显示没有真实依据的 Connected/Last checked；catalog 含各家官方申请 key 链接（列表 ↗ 与详情表单旁两处） |
| Provider Detail | 可输入、替换 user-config 密钥；清空输入后保存即清除（不再单独提供 Clear 按钮）；保存/清除成功后给 toast 提示；密钥名称由系统按 Provider 固定映射 |
| `.env` | `.env` 来源只读且优先级最高；页面只能说明其来源，不能覆盖或删除 |
| 密钥小眼睛 | 默认隐藏；只切换当前尚未提交的输入值；绝不回显已保存或 `.env` 明文 |
| 密钥存储 | 本批使用现有加密 user-config；未来可以迁移到数据库，但浏览器 DTO 不依赖存储介质 |
| 列表刷新 | 不提供手动 Refresh 按钮；进入页面与标签页重新可见时自动重取；不做定时轮询 |
| Settings | 职责未定义前从导航移除，不保留 disabled 占位 |
| 视觉 | 延续暖白、陶土色、编辑工作室气质；减少卡片、圆角和阴影的滥用 |

## 0.3 已确认：Provider 与凭证映射

Provider 不是用户可动态增加的开放集合。本批固定映射如下：

| Provider | Provider ID | 凭证名 | 备注 |
|---|---|---|---|
| fal.ai | `fal` | `FAL_KEY` | 独立 adapter |
| ZenMux | `zenmux` | `ZENMUX_API_KEY` | 独立 adapter |
| SiliconFlow | `siliconflow` | `SILICONFLOW_API_KEY` | 独立 adapter |
| Zhipu AI | `zhipu` | `ZHIPU_API_KEY` | 独立 adapter |
| Doubao | `doubao` | `ARK_API_KEY` | 火山方舟凭证 |
| Qwen | `qwen` | `DASHSCOPE_API_KEY` | DashScope |
| Kling | `kling` | `KLING_API_KEY` | **不走 DashScope**，使用 Kling 独立 API |

Provider 列表中的“Configured”只表示有效解析链上存在凭证；它不代表厂商网络可达、账户有余额或模型调用成功。

## 0.4 已确认：路由与数据作用域

| 路由 | Workspace 壳 | 数据范围 |
|---|---|---|
| `/` | 否，顶部品牌条 | 全部 Workspace 摘要 |
| `/workspace/:projectId/generate` | 是 | 当前 Project 与当前 Session |
| `/workspace/:projectId/history` | 是 | 当前 Project 下的非空 Session/Generation，只读 |
| `/workspace/:projectId/gallery` | 是 | 全局收藏，当前 Project 仅作为导航上下文 |
| `/workspace/:projectId/models` | 是 | 全局模型启用偏好 |
| `/workspace/:projectId/providers` | 是 | 全局固定 Provider 目录 |
| `/workspace/:projectId/providers/:providerId` | 是 | 全局单 Provider 配置 |

Generation Detail 无路由，为共享弹层；打开期间调用 `GET /api/generations/:id` 推进 poll。

UI 文案使用 Workspace，代码和 HTTP DTO 继续使用 Project/`projectId`。本批不进行领域实体重命名。

## 0.5 已确认：首批过滤范围

| 页面 | 本批包含 | 后续再做 |
|---|---|---|
| History | Session 页码、组内加载更多、批次缩略图条、组折叠 | Prompt 搜索、日期、Provider、状态高级筛选 |
| Gallery | 顶部 Workspace/Provider 筛选条、Newest、Load more | 全文搜索、下载管理、复杂方向筛选 |
| Models | 客户端模型搜索、Provider 筛选、未配置 Provider 页头提示 | 服务端搜索、批量操作、自定义模型 |
| Providers | 固定目录、配置来源、申请 key 链接、进入详情、自动刷新摘要 | Add provider、远端连接测试、余额检查 |

## 0.6 本批明确不做

1. 不在规划阶段写 React、CSS、API、数据库或测试实现。
2. 不做多用户、组织、团队、SaaS 密钥隔离。
3. 不把 Provider key 迁入业务数据库。
4. 不增加未知 Provider、自定义 Provider schema 或插件系统。
5. 不伪造连接状态、检查时间、生成耗时或虚假进度条。
6. 不改变后台 worker、取消、限流、图片生命周期等已落地后端职责。
7. 不让 History/Gallery/List 请求推进 provider poll。
8. 不逐像素复制参考图，也不因此引入运行时组件库（Ant Design / MUI 等）。
9. 不设计尚无产品职责的 Settings；不做明暗主题切换（移除现有开关）。
10. 不做 History/Gallery 手动 Refresh 按钮与定时轮询。
11. 图片预览第一批不做左右切换。

## 0.7 与既有文档的关系

- `docs/mvp/web-ui/*.md` 是当前运行时说明；其中“单页 view state”等描述会在实施完成后被本方案替代。
- `docs/mvp/api/constraints.md` 中“无浏览器写 key 路由”是当前基线；本方案新增安全写入边界，必须在实现后同步更新。
- `docs/mvp/user-config/*.md` 继续是加密文件、env 优先级和权限约束的权威来源。
- `docs/mvp/provider-fanout-react-wiring/improve-1/` 保留为上一轮接线改造记录，不由本批改写。
- `docs/test-blueprint.md` 是测试分类、命名、mock 和 CI 策略的项目级权威规则。

## 0.8 用户确认记录

本轮确认包括：一次性完成全部文档；首页顶部品牌条与 Workspace 完整侧栏；History 隐藏空 Session；Providers 无 Add provider、无虚假 Connected/Last checked；Gallery 全局收藏；`.env` 只读；Kling 使用独立 API key；文档落点固定为本目录。

## 0.9 第二轮修订记录（2026-07-17）

第二轮讨论基于浏览器实际走查当前 UI 后展开，对以下已确认项做出修订，本节与上方表格（已同步更新）共同构成最新契约：

| # | 修订项 | 原结论 | 新结论 |
|---|---|---|---|
| R1 | UI 组件库 | 不引入 UI 框架 | 引入 shadcn/ui（Tailwind + Radix，源码复制型）；页面布局仍用 CSS Modules |
| R2 | 多语言 | 不做 | 做。默认中文、可切英文，轻量 context 方案，localStorage 记忆 |
| R3 | 主题 | 未提及 | 明确不做明暗切换，移除现有 Light 开关 |
| R4 | 首页品牌 | 左侧 72px 窄品牌 Rail | 顶部品牌条，右侧放语言切换 |
| R5 | Generation Detail | 独立路由页面，唯一 poll owner | 共享卡片弹层（无路由）；poll 持有方 = Generate 结果区（当次提交）+ Detail 弹层（打开期间） |
| R6 | Generate 提交后 | 跳转 Detail 页 | 不跳转，进度与结果内嵌在 composer 下方结果区 |
| R7 | Generate 按钮 | 提交期禁用 | 生成中直接变身 Cancel |
| R8 | Recent 10 | Generate 保留轻量入口 | 整体移除（结果区看当次，历史去 History） |
| R9 | 首个 Session | 用户手动创建 | 新 Workspace 首次进 Generate 自动创建；name = `session-` + id 前 8 位；可改名（复用已有 PATCH） |
| R10 | 图片预览 | 本批可不做 lightbox | 做：简单预览弹层（左图 + 右侧信息卡），单张 + 关闭，无左右切换；一次只开一个弹层 |
| R11 | Gallery Workspace 标签 | 每张图显式显示来源标签 | 无常驻标签；来源信息收于预览弹层信息卡 |
| R12 | 列表刷新 | 手动 Refresh 按钮 | 无按钮；进页面与标签页重新可见时自动重取；无定时轮询 |
| R13 | History 行 | 缩略图单列 | 批次缩略图条（5–6 张 + `+N` 溢出） |
| R14 | History 组折叠 | 展开/收起 | 保留折叠，默认最新一组展开、其余收起 |
| R15 | Provider Clear | 独立 Clear 按钮 + 二次确认 | 无 Clear 按钮；清空输入后 Save 即删除（UI 调 DELETE） |
| R16 | 保存反馈 | 就地展示 | 成功给 toast（shadcn sonner）；错误仍就地展示 |
| R17 | 申请 key 链接 | 无 | catalog 新增各家官方申请链接，列表 ↗ 与详情表单旁两处展示 |
| R18 | Models 未配置提示 | 未配置 Provider 完全不出现 | 列表仍不出现，但页头给轻提示“还有未配置的 Provider，去配置 →” |

## 0.10 实施顺序修订（2026-07-18）

页面样式方向尚未完成最终讨论，不能与数据契约和前端接线混在同一批实施。已确认采用以下顺序：

1. **Backend Contract**：补齐专用读模型、Provider 配置安全接口、详情 DTO 和必要的并发/错误契约，并先以 contract/integration 测试封住。
2. **Frontend API Wiring**：补齐 typed client、请求状态、鉴权门与轮询协调；不实施最终路由页面布局、视觉 CSS 或设计系统。
3. **Visual Decision Gate**：基于真实接口和数据逐页讨论最终布局、密度、响应式与中英文排版。
4. **UI Implementation**：在视觉确认后才落地 App Router 页面、Tailwind/shadcn、CSS Modules 和完整 i18n。

这不是减少功能范围：Home、Generate、History、Gallery、Models、Providers 与 Provider Detail 的产品行为仍以本文件和页面目录为准；仅把表现层从行为契约中拆出，以避免临时 UI 的返工。
