# user-config 模块 · goals-duty

> 模块路径: `src/lib/user-config/`（**后续实现**；本轮仅边界文档）
> 文档顺序: ① goals-duty → ② architecture → ⑥ non-functional → ⑦ test（实现时补齐）

---

## 1. Design Goals

1. **把厂商 API key 等机密从业务库与仓库 `.env` 工作流中逐步迁出到「用户级配置」**。
2. **配置存储与业务 SQLite 分离**（用户目录、可加密）。
3. **本轮开发期仍允许 `.env` 为唯一真实来源**；本模块先占位边界，避免 providers 日后难拆。

---

## 2. Duties（目标态）

1. 在用户级目录读写加密（或 OS keychain 辅助）的凭证存储。
2. 向 providers registry 提供「解析后的 key 是否存在」而不把明文 key 暴露给 API 响应。
3. 定义与 env 的优先级：`env 覆盖 > 用户配置 > 未配置则禁用`。

---

## 3. Non-Duties

1. **本轮不实现**写入 UI / 加密库（Providers 页只读状态）。
2. 不存储 generation/project 等业务数据。
3. 不通过 HTTP 返回 key 明文。
4. 不做多用户云同步。

---

## 自检

- 一句话: 未来的用户级加密凭证配置域；与业务库分离。
- 现在: 文档占位 + providers Non-Duties 指向此处。
