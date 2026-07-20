# web-client 模块 · architecture

> 前置: goals-duty.md

---

## 1. Overview

```
web-client/
  types.ts           # DTO 与状态枚举
  api-client.ts      # fetch 封装与各资源方法
  poll-registry.ts   # 共享详情轮询、失败预算与暂停
  submission-intent.ts # sessionStorage 幂等意图
  capabilities.ts    # deriveGenerationControls
  index.ts           # 导出
```

依赖: 浏览器 `fetch`；可选相对路径 `/api`。

---

## 2. Patterns

- **Facade**: `createApiClient()` 聚合资源方法。
- **纯函数派生**: capabilities → controls，便于单测。
- 浏览器 runtime 只共享瞬时 poll registry，不承担业务数据缓存。

---

## 3. File Layout

与现有 `src/lib/web-client/` 对齐；扩展 methods 时保持同文件或按资源拆分（prefs/favorites）——以「改一处资源不翻十处」为准。

---

## 4. Constraints

- 仅在 client / 同构安全代码中引用。
- list generations **不**假装推进 poll；详情 GET 才推进。
- submit 30 秒、detail/cancel 15 秒 deadline；轮询在 offline/hidden 时不发请求，连续 6 次失败后等待用户手动恢复。
- Seed、negativePrompt、aspectRatio 等共享参数按全部 targets 的 capability 交集派生。
