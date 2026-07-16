# library 模块 · dfd-interface

> 模块路径: `src/lib/library/`
> 前置文档: architecture.md, data-model.md
> 文档顺序: … → ④ dfd-interface(本文) → ⑤ use-case → ⑦ test

---

## 1. Context & Scope（上下文与范围）

library 位于 **API 薄路由** 与 **db** 之间，服务 web-ui 的 Project 门禁、History、Gallery、Models 启用池。

```
web-ui ──HTTP──► api routes ──► library ──► db
                      │              │
                      │              └──► providers.registry（只读，校验偏好）
                      └──► job-engine（生成；不经 library 写 generation）
```

本文只描述进入/离开 library 的数据流，不描述厂商协议。

---

## 2. Data Flow（数据流）

### 2.1 创建 Project → 创建 Session → 进入工作台

1. UI 提交 title → API → `library.createProject` → db insert project
2. UI 提交 projectId + title → `library.createSession` → 校验 project 存在 → insert session
3. UI 持有 `{ projectId, sessionId }` 作为 Generate 上下文

### 2.2 提交生成（library 只读校验侧）

1. API 在调用 job-engine 前：校验 session 存在且属于声明的 project（可调 `library.assertSessionInProject` 或 db 等价查询）
2. job-engine 写 generation（**必填 sessionId**）并扇出
3. library 不参与 submit/poll

### 2.3 History / 最近 N 次

1. UI 请求最近 N 次或某 project/session 下列表
2. `library.listRecentGenerations` / `listBySession` → db join → 返回摘要视图（含 images 元数据与 url 路径约定）

### 2.4 收藏 → Gallery

1. UI 对 imageId 收藏 → `library.addFavorite` → 校验 image 存在 → insert favorite
2. Gallery 列表 → `library.listFavorites` → join image/job/generation/session/project → GalleryItem[]

### 2.5 模型启用池

1. Models 页切换启用 → `library.setModelEnabled`
2. Generate 加载可选池 → `library.listEnabledModels` 与 `GET /api/providers` 结果求交 → UI 勾选

### 2.6 Session 跨 Project 移动

1. UI 指定 sessionId + targetProjectId → `library.moveSession` → 更新 session.projectId（generation 行不改 sessionId）

---

## 3. Interfaces（接口形态）

以下为 **逻辑接口**（函数名可调）；HTTP 映射见 `docs/mvp/api`。

### 3.1 Projects

| 操作 | 输入 | 输出 |
|------|------|------|
| createProject | `{ title }` | Project |
| listProjects | — | Project[]（按 updatedAt desc） |
| getProject | `{ id }` | Project |
| updateProject | `{ id, title }` | Project |
| deleteProject | `{ id }` | void；有 Session → **409** |

### 3.2 Sessions

| 操作 | 输入 | 输出 |
|------|------|------|
| createSession | `{ projectId, title? }` | Session |
| listSessions | `{ projectId }` | Session[] |
| getSession | `{ id }` | Session |
| updateSession | `{ id, title }` | Session |
| moveSession | `{ sessionId, toProjectId }` | Session |
| assertSessionExists | `{ sessionId }` | void / 抛错 |

**MVP 不提供** deleteSession。

### 3.3 History / generations list

| 操作 | 输入 | 输出 |
|------|------|------|
| listGenerations | `{ limit, cursor?, sessionId?, projectId? }` | `{ items: GenerationSummary[], nextCursor }` |
| （详情推进） | 不经 library | `job-engine.getGeneration` ← `GET /api/generations/:id` |

规则权威：`api/constraints.md` §15.2（互斥 query、瘦 DTO、**list 不 poll**）。

### 3.4 Favorites

| 操作 | 输入 | 输出 |
|------|------|------|
| addFavorite | `{ imageId }` | GalleryItem（幂等） |
| removeFavorite | `{ imageId }` | void |
| listFavorites | `{ limit, cursor? }` | `{ items: GalleryItem[], nextCursor }` |

GalleryItem 字段权威：`api/constraints.md` §15.3。

### 3.5 Model prefs

| 操作 | 输入 | 输出 |
|------|------|------|
| listModelPreferences | — | 已写入行（可为 []） |
| upsertModelPreference | `{ provider, model, enabled }` | 该行；未知模型 → 400 |

**默认全开**：无行 = enabled。权威：`api/constraints.md` §15.4。

---

## 4. Error & Edge Semantics

| 情况 | 行为 |
|------|------|
| session / project 不存在 | 404 / 创建时 400 |
| 收藏不存在的 image | 404 |
| 重复收藏 | 幂等成功 |
| 删除非空 Project | **409** |
| 偏好指向 registry 外模型 | **400** |
| list 同时 sessionId + projectId | **400** |

---

## 5. 与 API 路由的对应

**以 `docs/mvp/api/constraints.md` §12 / §14 / §15 为唯一 HTTP 契约。** 下表仅作索引：

| HTTP | library |
|------|---------|
| `GET/POST /api/projects` | list/create |
| `GET/PATCH/DELETE /api/projects/:id` | get/update/delete |
| `GET/POST /api/projects/:id/sessions` | list/create |
| `GET/PATCH /api/sessions/:id` | get/update（GET include=generations 由 API 编排 job-engine） |
| `POST /api/sessions/:id/move` | moveSession |
| `GET /api/generations?...` | listGenerations |
| `GET/POST/DELETE /api/favorites...` | favorites |
| `GET/PUT /api/model-preferences` | model-prefs |

`POST /api/sessions`（无 project）→ API **400**。
