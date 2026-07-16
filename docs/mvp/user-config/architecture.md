# user-config 模块 · architecture

> 前置: goals-duty.md
> 状态: **2026-07-16 已实现**；与业务 SQLite 分离。

---

## 1. Overview（目标态）

```
user-config/
  resolve-credentials.ts   # env ⊕ 用户库 → ProviderSecrets
  store.ts                 # 用户目录加密 JSON envelope（AES-256-GCM + scrypt）
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

`src/lib/user-config/` 已实现：`USER_CONFIG_DIR`（默认 `~/.config/open-image-generator`）下的 `credentials.enc.json`，目录 0700、文件 0600，写入采用临时文件 + rename。

---

## 4. Trade-offs

| 选择 | 放弃 | 原因 |
|------|------|------|
| 用户目录库 | 写入业务 db | 备份/分享项目时不泄露 key |
| env 可覆盖 | 纯 UI 配置 | 开发与 CI 友好 |

解析顺序固定为 `process.env[NAME] > encrypted store > undefined`。解密失败只记录 warning 并回退环境变量，不阻断业务库启动。
