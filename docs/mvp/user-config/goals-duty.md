# user-config 模块 · goals-duty

> 模块路径: `src/lib/user-config/`（2026-07-16 已实现）
> 文档顺序: ① goals-duty → ② architecture → ⑥ non-functional → ⑦ test（实现时补齐）

---

## 1. Design Goals

1. **把厂商 API key 等机密从业务库与仓库 `.env` 工作流中逐步迁出到「用户级配置」**。
2. **配置存储与业务 SQLite 分离**（用户目录、可加密）。
3. **开发期仍允许 `.env` 覆盖用户库**；env 优先，方便 CI 与临时切换。

---

## 2. Duties（目标态）

1. 在用户级目录读写 AES-256-GCM+scrypt 加密凭证文件（不是业务 SQLite）。
2. 向 providers registry 提供「解析后的 key 是否存在」而不把明文 key 暴露给 API 响应。
3. 定义与 env 的优先级：`env 覆盖 > 用户配置 > 未配置则禁用`。

---

## 3. Non-Duties

1. 不通过浏览器 API 暴露明文写 key；服务端/CLI 可调用显式 `writeCredentials()`。
2. 不存储 generation/project 等业务数据。
3. 不通过 HTTP 返回 key 明文。
4. 不做多用户云同步。

---

## 自检

- 一句话: 未来的用户级加密凭证配置域；与业务库分离。
- 现在: `src/lib/user-config/` 已提供加密读写、权限收紧、env 优先和损坏库回退 warning。
