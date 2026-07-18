# 1. 问题基线与当前实施状态

> 时间口径：2026-07-17，`mvp` 分支未实施本轮前端重构之前。<br>
> 本文只描述现状、差距和风险；目标方案集中在 `02`。

## 1.1 核心问题

1. **页面看似分开，运行时仍是一个页面。** `src/app/page.tsx` 只挂载 `GenerateWorkbench`，`src/components/generate-workbench.tsx` 通过 `activeView` 决定五个视图，路由、状态和副作用没有形成页面边界。
2. **Workspace/Session 上下文与所有功能耦合。** Workspace 选择卡在每个视图顶部重复出现，即使 Gallery、Models、Providers 并不需要 Session；页面职责被一个公共状态容器绑在一起。
3. **视觉层级依赖“卡片套卡片”。** `src/app/globals.css` 同时承担壳、页面、表格、按钮、响应式等全部样式，边框、圆角、阴影成为主要分组手段，信息密度低且难以独立调整某页。
4. **新产品需求缺少服务端读模型。** 当前 API 有通用 Project、Session、Generation、Favorite 列表，但不能直接、高效表达“非空 Session 分页”“Project 摘要”“全局 Gallery 服务端过滤”“七家 Provider 配置来源”。
5. **密钥后端能力与 UI 边界尚未对齐。** `src/lib/user-config/` 已能加密读写，但没有 same-origin 配置 API；现有 `/api/providers` 只返回启用 Provider，不能展示固定目录或安全配置摘要。

## 1.2 当前目标/职责分界

系统是单用户、本地优先的模块化单体。Web UI 负责展示、输入、路由和调用 HTTP facade；不持有数据库、Provider adapter 或密钥明文。`docs/mvp/web-ui/goals-duty.md` 已明确 Generate 提交、详情轮询、History/Gallery/Models/Providers 初始职责，但其目标态仍以单页 view-state 和只读 Provider 凭证为基础，已无法覆盖本轮确认的多页面与配置入口。

保留不变的后端分界：

- `src/lib/job-engine/` 负责 generation/job 编排、轮询推进、取消和 worker。
- `src/lib/library/` 负责 Project、Session、History、Favorite、Model Preference 读写。
- `src/lib/providers/` 负责固定 Provider capability 与 adapter。
- `src/lib/user-config/` 负责加密凭证文件；env 始终优先。
- `src/lib/web-client/` 负责浏览器端 HTTP 契约。
- Web UI 不绕过 `/api/*` 直接导入服务端存储或 registry。

## 1.3 goals-duty 现状

### 1.3.1 已有职责

`docs/mvp/web-ui/goals-duty.md` 已覆盖 Project/Session 创建、Provider/Model 启用池、生成提交、轮询、收藏和五个初始页面。`src/components/generate-workbench.tsx` 基本兑现了创作主路径，`src/components/library-pages.tsx` 兑现了 Library 页面的初始只读能力。

### 1.3.2 职责重叠与缺口

| 现状 | 证据 | 风险 |
|---|---|---|
| 一个根组件同时负责 App Shell、Workspace、Session、Generate、轮询、收藏和所有 Library 页面 | `src/components/generate-workbench.tsx` | 任何页面改动都可能触发无关状态和回归，难以测试页面职责 |
| `LibraryPage` 再按 view 分发四页 | `src/components/library-pages.tsx` | 文件名是 Library，实际同时承担配置型 Models/Providers，概念边界不准确 |
| Gallery/Models/Providers 被迫接收 Workspace/Session 公共上下文 | `GenerateWorkbench` 对 `LibraryPage` 的 props | 无关依赖增加，页面无法独立深链和刷新 |
| Provider 配置 UI 尚无职责归属 | `/api/providers`、`src/lib/user-config/` | 若直接在前端复用服务端模块会突破安全边界 |

当前功能并非不可用；问题是职责已经超过“一个工作台组件”合理承载范围。

## 1.4 architecture 现状

### 1.4.1 当前构造

```text
src/app/page.tsx
  └── GenerateWorkbench (client)
      ├── App shell / nav / workspace controls
      ├── Generate form / result / polling
      ├── Inspector
      └── LibraryPage(view)
          ├── HistoryPage
          ├── GalleryPage
          ├── ModelsPage
          └── ProvidersPage
```

`src/app/layout.tsx` 只有全局根布局，没有 workspace 级 layout。`src/app/globals.css` 中 `.app-shell` 使用 `242px minmax(0, 1fr) 360px` 三栏网格。非 Generate 页虽然不渲染 inspector 内容，壳仍以同一列模型为基础，造成可见的右侧空白与内容宽度浪费。

### 1.4.2 神文件与依赖方向

- `src/components/generate-workbench.tsx` 约 1100 行以上，UI、业务状态、请求编排和页面导航混在一起。
- `src/app/globals.css` 约 1700 行以上，全局选择器使局部页面调整具有不可预测的溢出影响。
- `src/components/library-pages.tsx` 将 History、Gallery、Models、Providers 共置，页面之间只因“都不是 Generate”而被复用。
- 仍有一个可取的依赖方向：浏览器组件统一通过 `src/lib/web-client/api-client.ts` 调用 API，没有直接导入 DB 或 adapter。这个边界应保留。

### 1.4.3 可逆性

当前 `activeView` 是可逆的早期 MVP 选择，不涉及数据迁移。改成 App Router 文件路由属于中等改动，但不会改变 Project/Session/Generation 的持久化身份。真正需要谨慎的是 API DTO：如果页面直接依赖 user-config 文件格式，未来迁移数据库会成为高成本的一扇门。

## 1.5 data-model 现状

### 1.5.1 已有核心概念

`src/lib/web-client/types.ts` 已定义 `Project`、`Session`、`GenerationView`、`GenerationSummary`、`GalleryItem`、`ModelPreference` 和 `ProviderInfo`。这些概念与 `src/lib/library/types.ts`、`src/lib/db/schema.ts` 基本一致。

### 1.5.2 缺失的页面读模型

| 页面问题 | 当前已有 | 缺失 |
|---|---|---|
| Home 最近 Workspace | `Project[]` | Session/Generation/Image 数、最近活动和可选封面摘要 |
| History Session 分组 | 扁平 `Page<GenerationSummary>` | 非空 Session 的外层页码、每组总数、组内 cursor |
| Generation Detail 弹层上下文 | `GenerationView.sessionId` | 用于全局 Gallery 来源展示与安全校验的 `projectId`；弹层本身不占路由 |
| Gallery 过滤 | `GalleryItem` 已含 project/provider | 服务端接受 project/provider/sort 的查询契约 |
| Providers 固定目录 | `/api/providers` 只列 enabled | 七家目录、credentialName、configured、source、available/enabled model 数 |
| Provider Detail | 无公开 DTO | 不含 secret 的单 Provider 配置摘要 |

这些不是新领域实体，应该作为页面查询 DTO，而不是新增数据库表。

## 1.6 dfd-interface 现状

### 1.6.1 Generate 数据流

当前数据流为：组件加载 Project/Session、Provider/Model Preference → 提交 `POST /api/generations` → 通过响应 `links.self` 调用 `GET /api/generations/:id` → 更新状态和图片。`src/lib/web-client/polling.ts` 提供轮询控制，方向正确。

问题在于数据流由根组件集中编排，导航离开“视图”并不会天然触发页面生命周期卸载；轮询所有权不够清晰。

### 1.6.2 History/Gallery 数据流

- `src/lib/web-client/api-client.ts#listGenerations` 支持 `sessionId`/`projectId`/cursor；`src/app/api/generations/route.ts` 经 library 只读。
- `src/lib/web-client/api-client.ts#listFavorites` 只支持 `limit`/cursor；`src/app/api/favorites/route.ts` 暂无 Workspace/Provider 查询参数。
- `src/app/api/sessions/[id]/route.ts` 有明确注释：Session 详情读取不推进 job。

只读语义已经正确，但现有通用列表不足以高效构建新的分组和过滤体验。若在客户端先拉取大量数据再分组，会造成分页结果错误和不必要 IO。

### 1.6.3 Provider 配置数据流

当前只有：env/加密文件 → `resolveCredential` → registry → `/api/providers` 的 enabled provider 列表。缺少浏览器配置写路径。`src/lib/user-config/store.ts` 使用 AES-256-GCM、scrypt、临时文件 + rename 和 0600 权限，安全基础已存在；但 `read → merge → write` 的 API 编排和并发写序列化尚未定义。

## 1.7 use-case 现状

### 1.7.1 已可完成

- 创建 Project、Session 并提交多 Provider 生成。
- 查看当前 generation 的 provider job 状态并轮询到终态。
- 查看当前 Session 最近 generation。
- 收藏/取消收藏图片并打开 Gallery。
- 设置 Model Preference。
- 查看当前已配置 Provider。

### 1.7.2 受阻或语义不完整

| 用例 | 当前阻碍 |
|---|---|
| 启动后选择 Workspace | `/` 直接进入工作台，首页与 Workspace 壳没有边界 |
| 用可分享 URL 打开 History/Provider | 所有视图共用 `/`，刷新后视图状态不稳定 |
| 浏览 Workspace 历史 | 当前 History 依赖选中的单 Session，不是 Project 下按 Session 分组 |
| 浏览全局收藏并辨别来源 | DTO 有来源，但初始页面缺少完整筛选和稳定信息层级 |
| 为未配置 Provider 填密钥 | 没有写 API 或详情页 |
| 查看已保存密钥 | 产品上必须禁止；当前没有 UI，后续实现尤其容易误做成回显 |
| 查看仍在运行的旧 Generation | 缺少可从 History/Gallery 显式打开的共享详情弹层和明确轮询所有权 |

## 1.8 non-functional 现状

### 1.8.1 性能与并发

后端生成扇出已支持多 Provider 并发，前端重构不应把请求串行化。页面查询目前数据量小可用，但若 Home 逐 Project 发请求、History 逐 Session N+1 拉取、Gallery 客户端全量过滤，数据增长后延迟会线性恶化。

### 1.8.2 可靠性

- `src/lib/web-client/api-client.ts` 有统一 `ApiClientError`，但错误只有字符串和 status，页面级恢复策略尚不统一。
- 轮询控制已有单元测试基础，但当前根组件同时承担刷新、切视图和请求，容易出现陈旧响应覆盖新选择。
- user-config 文件写入原子，但多个并发 API 写若各自读取旧快照，仍可能互相覆盖不同 Provider 的 key。

### 1.8.3 安全

- 已保存密钥不会通过现有 API 暴露，这是必须保持的优点。
- `USER_CONFIG_ENCRYPTION_KEY` 缺失会使写入失败；未来 UI 必须给出可行动但不泄密的错误。
- 项目支持可选 `APP_AUTH_TOKEN`；新增所有 Provider 配置 API 必须沿用同一认证边界。
- 浏览器、日志、错误、React state 持久化和测试 snapshot 都不应保留已提交 secret。

### 1.8.4 可访问性与响应式

现有页面已有部分 `aria-label` 与按钮语义，但表格式信息多使用视觉 `div`，Switch、展开行、密钥可见切换、移动侧栏等新交互尚无统一键盘和焦点约定。`globals.css` 有多个断点，但围绕固定三栏壳演进，不能自然覆盖首页窄栏和列表页面宽内容。

## 1.9 test 现状

项目级规则见 `docs/test-blueprint.md`，现有测试重点在后端 unit/contract/integration；`src/lib/web-client/` 有 API client、capabilities、polling 单测。当前没有浏览器 E2E 框架，也没有页面级组件测试设施。

主要缺口不是覆盖率数字，而是这些行为风险没有自动契约：

1. 新路由和 project/generation 归属。
2. History 非空 Session 页码 + 组内 cursor 的稳定性。
3. Gallery 服务端过滤跨 cursor 的正确性。
4. Provider 配置响应永不含 secret、env 不可覆盖、并发更新不丢 key。
5. 只有 Generate 结果区与用户显式打开的 Generation Detail 弹层可以推进详情 poll。
6. 离开 Generate、关闭弹层或切换筛选后停止浏览器轮询，陈旧请求不覆盖新状态。

视觉、焦点、响应式仍需要人工浏览器验收；在未引入 E2E 工具前，不应假装已有自动化像素测试。

## 1.10 文档与实现对照

| 文档约束 | 当前代码 | Gap |
|---|---|---|
| `docs/mvp/web-ui/architecture.md`：一个 page 内 view state | `GenerateWorkbench.activeView` | 与本轮真实路由决策冲突，实施后更新文档 |
| `docs/mvp/api/constraints.md`：只有详情 GET 推进 poll | 详情 route + Session/列表只读 | 已符合；前端只能由结果区与显式 Detail 弹层发起，必须回归保护 |
| `docs/mvp/api/constraints.md`：本轮无写 key route | 无 Provider 配置 API | 本方案明确新增安全 route，实施后更新 |
| `docs/mvp/user-config/architecture.md`：env > encrypted file | `resolveCredential`/`store.ts` | 已符合；新 UI 不得改变优先级 |
| `docs/mvp/library/dfd-interface.md`：Favorites 可回溯 Project | `GalleryItem.projectId/projectTitle` | 已具备标签基础，缺服务端过滤 |
| `docs/mvp/web-client/dfd-interface.md`：列表不 poll | `listGenerations`/`listFavorites` | 已符合，新增聚合查询也必须只读 |

## 1.11 改动影响面（现状视角）

- 页面与路由：`src/app/`、`src/components/`。
- 样式：`src/app/globals.css`，后续新增页面/组件 CSS Modules。
- 浏览器契约：`src/lib/web-client/types.ts`、`api-client.ts`。
- 只读聚合：`src/lib/library/`、`src/lib/db/queries/`、对应 API routes。
- Provider 配置：`src/lib/user-config/` 上层 service、新 API routes；不改 adapter 协议。
- 测试：co-located unit、`tests/contract/`、`tests/integration/`，以及人工浏览器 QA。
- 文档：`docs/mvp/web-ui/`、`docs/mvp/api/constraints.md`、`docs/mvp/user-config/`、library/web-client 相关契约。

## 1.12 SWE 审视摘要

当前实现是合理的 MVP 纵切，但已出现“因新增需求而自然长成的神文件”、按技术方便而非业务职责分组、全局 CSS 抽象泄漏和客户端聚合倾向。应在真实页面边界处拆分，而不是提前建立通用页面框架；共享层只收纳跨页面稳定的壳与控件。新 API 应围绕明确查询用例建立专用只读模型，不引入 GraphQL、状态管理库、微服务或设计系统包等与本批风险无关的复杂度。
