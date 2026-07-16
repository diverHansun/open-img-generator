# user-config 模块 · architecture

> 前置: goals-duty.md
> 状态: **后续里程碑**；结构为建议，不阻塞 library 实现。

---

## 1. Overview（目标态）

```
user-config/
  resolve-credentials.ts   # env ⊕ 用户库 → ProviderSecrets
  store.ts                 # 用户目录 SQLite / 文件 + 加密
  paths.ts                 # OS 用户目录路径
```

providers.registry 启动时调用 `resolveCredentials()`，不直接读多处散落逻辑。

---

## 2. Patterns

- **Adapter 读凭证**: registry 只拿「有/无 key」，不关心存哪。
- **加密 at rest**: 见 non-functional。
- **不做**远程配置中心。

---

## 3. File Layout

`src/lib/user-config/` 待建；在实现里程碑前可仅保留文档。

---

## 4. Trade-offs

| 选择 | 放弃 | 原因 |
|------|------|------|
| 用户目录库 | 写入业务 db | 备份/分享项目时不泄露 key |
| env 可覆盖 | 纯 UI 配置 | 开发与 CI 友好 |
