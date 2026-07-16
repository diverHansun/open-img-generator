# library 模块 · data-model

> 模块路径: `src/lib/library/`（概念）+ 落库见 `docs/mvp/db/data-model.md`
> 前置文档: architecture.md
> 说明: 本文统一 library 认知模型；物理列以 db 文档为准。

---

## 1. Core Concepts（核心概念）

| 概念 | 一句话 | 分类 |
|------|--------|------|
| **Project** | 创作项目容器；Generate 工作台的作用域 | Entity |
| **Session** | Project 内的一次连续创作会话；必属于某 Project | Entity |
| **GenerationSummary** | 一次生成请求的列表/详情摘要（只读视图） | Value / View |
| **Favorite** | 用户对某张 Image 的收藏关系 | Entity |
| **GalleryItem** | 画廊条目 = Favorite + 回溯与展示字段 | View |
| **ModelPreference** | 某 (provider, model) 是否进入工作台启用池 | Entity / 配置行 |

与既有概念的关系（不重新定义）:

- **Generation / Job / Image**: 由 job-engine + db 拥有；library 只读聚合。
- **Session** 原可空挂 generation；本轮起 **Session 必有 Project**，**Generation 必有 Session**（见 job-engine / db 修订）。

---

## 2. 关键字段（逻辑）

### 2.1 Project

| 字段 | 含义 |
|------|------|
| id | UUID |
| title | 显示名 |
| createdAt / updatedAt | ISO 时间；有新 Session 或标题变更时更新 updatedAt |

### 2.2 Session

| 字段 | 含义 |
|------|------|
| id | UUID |
| projectId | **必填** FK → Project |
| title | 可选显示名 |
| createdAt / updatedAt | 有新 Generation 关联或标题变更时 touch |

### 2.3 Favorite

| 字段 | 含义 |
|------|------|
| id | UUID（或省略，用 imageId 作唯一键） |
| imageId | **唯一** FK → Image |
| createdAt | 收藏时间（Gallery 排序） |

### 2.4 ModelPreference

| 字段 | 含义 |
|------|------|
| provider | ProviderId |
| model | 模型 id |
| enabled | bool |
| updatedAt | 变更时间 |

唯一约束: `(provider, model)`。

### 2.5 GalleryItem（视图，不落独立业务表）

拼装字段与 HTTP 契约一致，权威见 `api/constraints.md` §15.3：

`favoriteId`, `imageId`, `url`, `width`, `height`, `favoritedAt`, `jobId`, `provider`, `model`, `generationId`, `prompt`, `sessionId`, `projectId`, `projectTitle`。

---

## 3. 不变量

1. `Session.projectId` 永非空。
2. 新建 Generation 时 `sessionId` 必填，且 Session 存在并属于某 Project。
3. Favorite 仅指向已存在 Image；同一 Image 至多一条 Favorite。
4. ModelPreference：无行视为 enabled；仅 `enabled=false` 剔除出池（见 `api/constraints.md` §15.4）。写入时必须通过 registry 校验。
5. 删除 Project / Session：MVP 仅允许删**无 Session** 的空 Project（409）；**不提供** Session DELETE。
---

## 4. 与 db 文档的分工

- **library/data-model**: 概念、不变量、视图形状。
- **db/data-model**: 表名、列类型、索引、迁移注意。
两者冲突时，以产品不变量为准，同步修订双方。
