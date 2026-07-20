# web-client 模块 · goals-duty

> 模块路径: `src/lib/web-client/`（代码已有，本轮补文档并扩展 API 面）
> 文档顺序: ① goals-duty → ② architecture → ④ dfd-interface → ⑦ test

---

## 1. Design Goals

1. **为浏览器侧提供类型安全的同源 API 访问**，避免组件内散落 fetch。
2. **集中 generation 轮询、请求 deadline 与终态判断**，遵守 `api/constraints.md` §2。
3. **集中 capabilities → 控件派生**（交集宽高比等），供 Generate 复用。
4. **不 bundling 服务端模块**（job-engine/providers 实现）。

---

## 2. Duties

1. HTTP 客户端：providers、generations CRUD/list、sessions/projects、favorites、model-preferences、health、images URL 辅助；Generation submit/detail/cancel 使用有界 deadline。
2. `GenerationPollingController`（或等价）按 backoff 轮询至终态；离线或页面隐藏时暂停，连续 6 次瞬时失败后等待用户恢复。
3. `deriveGenerationControls`：由选中 capabilities 派生 UI 控件模型。
4. 请求体构造（如 `buildSubmitGenerationRequest`）确保 sessionId 等必填字段，并维护短期 submission intent 以安全重放同一请求。

---

## 3. Non-Duties

1. 不渲染 React（纯 TS 模块）。
2. 不直连厂商。
3. 不持久化业务数据；`sessionStorage` 只保存有期限的 opaque submission intent 元数据，不保存 Prompt 或 Provider secret。
4. 不实现服务端校验逻辑副本以外的「权威」——以服务端 400 为准。

---

## 自检

- 一句话: 浏览器侧 API + 轮询 + capabilities 派生工具库。
- 不该做: UI、密钥、服务端编排。
