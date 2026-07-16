# web-client 模块 · dfd-interface

> 前置: architecture.md

---

## 1. Context

web-ui → web-client → `/api/*` → library / job-engine / providers。

---

## 2. Data Flow

1. UI 调用 `api.listProjects()` 等 → JSON DTO
2. UI 调用 `api.submitGeneration(body)` → 201 摘要
3. `polling.start(id, onUpdate)` → 反复 GET → 终态 stop
4. `deriveGenerationControls(selectedCaps)` → 控件模型

---

## 3. Interfaces（逻辑）

| 方法族 | 对应 API |
|--------|----------|
| projects/sessions | §12 projects/sessions |
| generations.submit/get/list | POST/GET/:id/GET?limit |
| favorites | favorites |
| modelPreferences | model-preferences |
| providers/health | 既有 |
| polling | 封装 GET/:id |
| deriveGenerationControls | 无网络 |

Submit body 必须含 `sessionId: string` 与 `targets[]`。

列表：`listGenerations({ sessionId, limit })` → `GenerationSummary[]`（不 poll）。
收藏 / prefs DTO 对齐 `api/constraints.md` §15。

---

## 4. Errors

网络/非 2xx → 抛出或 Result 类型（与现有 api-client 风格一致）；UI 负责展示。
