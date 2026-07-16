# web-client 模块 · architecture

> 前置: goals-duty.md

---

## 1. Overview

```
web-client/
  types.ts           # DTO 与状态枚举
  api-client.ts      # fetch 封装与各资源方法
  polling.ts         # GenerationPollingController
  capabilities.ts    # deriveGenerationControls
  index.ts           # 导出
```

依赖: 浏览器 `fetch`；可选相对路径 `/api`。

---

## 2. Patterns

- **Facade**: `createApiClient()` 聚合资源方法。
- **纯函数派生**: capabilities → controls，便于单测。
- **不引入**全局单例强制；由 UI 注入 baseUrl。

---

## 3. File Layout

与现有 `src/lib/web-client/` 对齐；扩展 methods 时保持同文件或按资源拆分（prefs/favorites）——以「改一处资源不翻十处」为准。

---

## 4. Constraints

- 仅在 client / 同构安全代码中引用。
- list generations **不**假装推进 poll；详情 GET 才推进。
