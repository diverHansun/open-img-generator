# web-ui 模块 · architecture

> 模块路径: `src/app/` + `src/components/`
> 前置文档: goals-duty.md
> 修订说明: 2026-07-16 ProjectGate、多页面 IA、最近 N 次、状态可见性

---

## 1. Architecture Overview（总体架构）

```
AppShell
  ├── NavRail (Generate | History | Gallery | Models | Providers | Settings?)
  └── Route views
        ├── ProjectGate          ← 无当前 project 时挡住 Generate 主面板
        ├── GenerateWorkbench    ← 绑定 projectId；Session 选择器 + Compose + Results(最近10) + Inspector
        ├── HistoryPage          ← Project → Session → Generation 树 + 看图
        ├── GalleryPage          ← 收藏网格 + 详情回溯
        ├── ModelsPage           ← 启用池开关
        └── ProvidersPage        ← 状态/健康（只读 key 配置来源说明）
```

| 子组件 | 职责 |
|--------|------|
| **ProjectGate** | 选/建 Project；写入「当前 projectId」 |
| **SessionSwitcher** | 当前 Project 下选/建 Session |
| **GenerateWorkbench** | prompt、当次模型勾选、参数、Generate、轮询、最近结果 |
| **ResultsByModel** | 按 job 展示 status + 图；禁止无状态空壳 |
| **HistoryPage / GalleryPage / ModelsPage / ProvidersPage** | 对应 IA |

**依赖**: 仅通过 `web-client`（或 fetch 封装）打 `/api/*`；不 import job-engine/providers 服务端实现。

---

## 2. Design Pattern & Rationale

### 2.1 Project-scoped workbench
同面板同 Project，支撑门禁目标；换 Project = 离开面板再选（或显式「切换项目」回 Gate）。

### 2.2 Capabilities 派生 UI
与既有一致：当次勾选集合 → 交集参数；启用池来自 model-preferences。

### 2.3 状态可见性优先
Workbench 在 pending 阶段即渲染 job 行（可用 POST 回显或乐观占位 + 首次 GET），避免「未知」。

### 2.4 未使用
不拆微前端；不引入重型全局状态库（MVP 以页面/工作台 state + web-client 足够）。

---

## 3. Module Structure & File Layout

```
src/app/page.tsx                 # 壳 + 视图切换（或后续 app router 多路由）
  src/components/
  project-gate.tsx
  generate-workbench.tsx         # 已有，扩展
  library-pages.tsx              # History / Gallery / Models / Providers view-state 页面
src/lib/web-client/              # API/poll/capabilities（见 web-client 文档）
```

---

## 4. Architectural Constraints & Trade-offs

| 取舍 | 选择 | 放弃 |
|------|------|------|
| 路由 | MVP 可用单页 view state；可演进 App Router | 过早多包前端 |
| 最近 10 次 | 服务端 list + 客户端展示 | 无限滚动全库 |
| 收藏单位 | Image | Generation |
| 密钥 UI | 只读说明 | 本轮可写 key |
