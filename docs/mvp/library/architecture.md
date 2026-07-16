# library 模块 · architecture

> 模块路径: `src/lib/library/`
> 前置文档: goals-duty.md
> 文档顺序: ① goals-duty → ② architecture(本文) → ③ data-model → ④ dfd-interface → ⑤ use-case → ⑦ test

---

## 1. Architecture Overview（总体架构）

```
library/
  ├── projects      ← Project CRUD + 列表
  ├── sessions      ← Session CRUD（强制 project_id）+ 跨 Project 移动
  ├── history       ← 最近 generation / 按 Project|Session 聚合视图
  ├── favorites     ← Image 收藏与 Gallery 列表/回溯
  └── model-prefs   ← 启用池读写
```

| 子组件 | 职责 | 依赖 |
|--------|------|------|
| **projects** | Project 命令与查询 | `db` |
| **sessions** | Session 命令与查询；校验所属 Project 存在 | `db`、projects（逻辑依赖） |
| **history** | 组装 History / 首页「最近 N 次」视图 | `db`（generations/jobs/images） |
| **favorites** | 收藏写与 Gallery 读；回溯拼装 | `db` |
| **model-prefs** | 启用集合持久化；与 registry 做交集过滤（过滤在读路径） | `db`、可选 `providers` registry（只读） |

**依赖方向（允许）**: library → db；library → providers（只读 registry/capabilities，用于校验偏好项仍合法）。
**禁止**: library → job-engine；job-engine → library（避免环）。Session 存在性校验在 job-engine/API 侧调用 db 或 library 的只读校验函数（若共用，放 db/queries 或 library/sessions 只读导出，由 API 编排）。

---

## 2. Design Pattern & Rationale（设计模式与理由）

### 2.1 按域分包，不按技术分层

不引入 Controller/Service/Repository 五层。library 内按 **projects / sessions / history / favorites / model-prefs** 切文件，支撑 Design Goal #1（资产域独立）与「路径 1+2 纪律」。

### 2.2 应用服务式入口（轻量）

每个子域导出若干明确函数（create/list/move/favorite…），由 `src/app/api/*` 薄调用。不引入事件总线。

### 2.3 读写分离（逻辑上，非独立库）

- **写组织**: Project/Session/Favorite/偏好 → library
- **写生成**: Generation/Job/Image → job-engine
- **读聚合**: history/favorites 读 db 已有表

支撑 Non-Duty「不创建 generation」。

### 2.4 未使用的模式

- 未用 CQRS/事件溯源：单机 SQLite MVP 过重。
- 未用 Repository 接口墙：仅一个 SQLite 实现，YAGNI。

---

## 3. Module Structure & File Layout（模块结构与文件组织）

建议布局（实现时可微调，职责不变）：

```
src/lib/library/
  index.ts                 # 对外 re-export
  types.ts                 # View/Command 类型
  projects.ts
  sessions.ts
  history.ts
  favorites.ts
  model-prefs.ts
  *.unit.test.ts           # 与文件同列或 __tests__ 按项目惯例
```

db 表定义与原始 queries 仍在 `src/lib/db/`；library 调用 queries，不在 library 内写 SQL 方言细节（复杂 join 可下沉到 `db/queries/*`）。

---

## 4. Architectural Constraints & Trade-offs（约束与取舍）

| 约束/取舍 | 选择 | 放弃 | 原因 |
|-----------|------|------|------|
| 与 job-engine 边界 | 无互相 import | 生成侧直接调 library 写收藏等 | 防环；收藏由 API/UI 调 library |
| Session 强制 Project | NOT NULL + 入口门禁 | Inbox / 零散 Session | 产品已锁定 |
| Gallery 单位 | Image 级收藏表 | Generation 级收藏 | 视觉墙 + 可回溯 |
| 偏好存储 | 业务库表 | 仅 localStorage | 多端/刷新一致；仍单用户 |
| 最近 N 次 | history 查询 | 前端自己扫全表 | 契约清晰，默认可改 N |

**假设（实现前可调）**: Project 删除策略 MVP = 禁止删除非空 Project，或仅允许空 Project 删除；文档在 use-case 写明默认「禁止删非空」。
