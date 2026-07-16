# Phase 8 · library 扩展跨模块一致性

> 日期: 2026-07-16
> 范围: library / db / job-engine / api / web-ui / web-client / providers / user-config

---

## 检查清单

| 项 | 结论 |
|----|------|
| Generation 必挂 Session；Session 必挂 Project | 一致：db NOT NULL、job-engine 必填、api §11、web-ui 门禁 |
| 无 Inbox / 零散 Session | 一致：library / web-ui Non-Duties |
| Gallery = Image 收藏 + 回溯 | 一致：library data-model / favorites / web-ui |
| History 可看图；首页最近 ~10 | 一致：library history + web-ui |
| Models 启用池 vs Generate 当次勾选 | 一致：model_preferences + web-ui |
| job-engine 不管 Project/Gallery | 一致：job-engine Non-Duties #13–14 |
| providers 不管密钥库 / 资产 | 一致：Non-Duties #8–9；user-config 后续 |
| 列表 GET 不推进 poll；详情 GET 推进 | 一致：library dfd + api §12 + web-client |
| 状态枚举不扩展；补 UI 可见性 | 一致：api §13 + web-ui |

---

## 已知残留（后续里程碑）

1. History / Gallery / Models 目前采用单页 view-state，后续可按需要拆成 App Router 路由。
2. **user-config** 仅文档占位，不阻塞当前单用户 `.env` 配置。

---

## 修订任务（文档自检跟进）

- [x] db / job-engine goals / dfd sessionId / api constraints / web-ui 套件 / library 套件 / web-client / user-config / providers Non-Duties
- [x] 扫并修订 job-engine dfd/use-case、api/quickstart 中过时「可选 session」
- [x] schema 显式迁移 + 测试 fixture 更新 + 本地 7 条孤儿 generation 清理

---

## 文档自检记录（2026-07-16）

| 检查项 | 结果 |
|--------|------|
| list/favorites/prefs DTO 与页面矩阵 | 已锁定：`api/constraints.md` §14–§15 |
| model-preferences 默认全开 + PUT 校验 | 已锁定：§15.4 |
| generations list sessionId / 瘦摘要 / 不 poll | 已锁定：§15.2 |
| GET /api/projects/:id；Session 不删 | 已锁定：§12 |
| 代码与文档差 | 后端 §12–§16 已实现；Session/History 列表只读 |
| 范围 | History/Gallery/Models 当前已接入；user-config 另拆 |
