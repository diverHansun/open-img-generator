# web-ui 模块 · dfd-interface

> 前置文档: goals-duty.md, architecture.md
> 关联: `docs/mvp/api/constraints.md`, library/dfd-interface.md
> 修订说明: 2026-07-16 Project 门禁、list/favorites/prefs、状态可见性

---

## 1. Context & Scope

| 方向 | API | 用途 |
|------|-----|------|
| 下游 | `/api/projects`, `/api/projects/:id/sessions`, move | 门禁与 Session |
| 下游 | `/api/providers`, `/api/model-preferences` | 启用池 ∩ 能力 |
| 下游 | `/api/generations` POST/GET/:id、GET list | 生成、轮询、最近 N 次 |
| 下游 | `/api/favorites` | Gallery |
| 下游 | `/api/images/:id`, `/api/health` | 展图、状态脚注 |

---

## 2. Data Flow

### 2.1 进入 Generate

```
无 currentProjectId
  → ProjectGate: GET/POST /api/projects
  → 选定后进入 Workbench(projectId)
  → GET /api/projects/:id/sessions；选或 POST 新建
  → GET providers + GET model-preferences → 启用池（无 prefs 行=默认开）
  → GET /api/generations?sessionId=&limit=10 → 最近结果（瘦摘要，不 poll）
```

### 2.2 生成与状态

```
Generate
  → POST { prompt, targets, sessionId, ... }  // sessionId 必填
  → 立即按 jobs 渲染 status（pending/running…）
  → loop GET /:id（constraints §2）至终态
  → 刷新最近列表
```

### 2.3 History / Gallery / Models

```
History: 拉 projects → sessions → generations（可嵌套或懒加载）
Gallery: GET favorites；POST/DELETE favorite
Models: PUT model-preferences
Providers: GET health + providers（只读）
```

### 2.4 参数派生

与既有交集规则相同；可选池先过滤 `enabled` prefs。negativePrompt 仅当全部勾选支持时显示。

---

## 3. Interfaces（UI → API）

见 `api/constraints.md` §11–§12。web-ui 不定义平行契约。

---

## 4. Error & Edge

| 情况 | UI |
|------|-----|
| 400 校验 | 文案展示，不清除整个工作台 |
| 部分 job failed | 该行 failed + error；其他行可 completed |
| 无启用模型 | Generate disabled |
| 轮询超时放弃 | 提示可稍后在 History 打开同一 generation 再 GET |
