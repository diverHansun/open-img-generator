# library 模块 · use-case

> 模块路径: `src/lib/library/`
> 前置文档: dfd-interface.md
> 文档顺序: … → ⑤ use-case(本文) → ⑦ test

---

## UC1 — 进入 Generate 工作台（Project 门禁）

**目标**: 用户进入主生成面板前已绑定 Project，并选好 Session。

| 步骤 | 责任方 | 动作 |
|------|--------|------|
| 1 | web-ui | 展示「选择已有 Project / 新建 Project」 |
| 2 | library | createProject 或 listProjects |
| 3 | web-ui | 进入工作台，作用域锁定该 projectId |
| 4 | web-ui | 选择已有 Session 或「新建 Session」 |
| 5 | library | createSession(projectId) / listSessions |
| 6 | web-ui | 默认续写「当前 Session」（上次使用的 sessionId，可存 localStorage 按 project 维度） |

**失败**: 无 Project 不得进入工作台主面板。

---

## UC2 — 在当前 Session 下生成

| 步骤 | 责任方 | 动作 |
|------|--------|------|
| 1 | web-ui | 从启用池勾选 targets，填 prompt，POST generation（带 sessionId） |
| 2 | api | assertSessionInProject（若请求还带 projectId） |
| 3 | job-engine | 创建 generation + jobs 并推进 |
| 4 | web-ui | 轮询 GET generation；结果区展示最近列表中的当前项 |

library 不参与步骤 3。

---

## UC3 — 首页最近 10 次 + History 承接

| 步骤 | 责任方 | 动作 |
|------|--------|------|
| 1 | library | listRecentGenerations(limit=10, projectId=当前) |
| 2 | web-ui | 工作台结果区可下滑浏览这批 |
| 3 | web-ui | 「更早」引导至 History |
| 4 | library | History 按 Project → Sessions → Generations 拉取 |

---

## UC4 — 收藏进 Gallery

| 步骤 | 责任方 | 动作 |
|------|--------|------|
| 1 | web-ui | 在结果图或 History 详情点收藏 |
| 2 | library | addFavorite(imageId) |
| 3 | web-ui | Gallery 页 listFavorites；点条目看回溯（prompt/model/job） |

取消收藏: removeFavorite。

---

## UC5 — Models 启用池

| 步骤 | 责任方 | 动作 |
|------|--------|------|
| 1 | providers | GET providers → 全量已配置厂商模型 |
| 2 | library | listEnabledModels |
| 3 | web-ui Models 页 | 开关 → setModelEnabled |
| 4 | web-ui Generate | 可选池 = registry ∩ enabled prefs |

---

## UC6 — Session 迁到另一 Project

| 步骤 | 责任方 | 动作 |
|------|--------|------|
| 1 | web-ui History | 选择 move |
| 2 | library | moveSession(sessionId, toProjectId) |
| 3 | 结果 | 该 Session 下所有 Generation 随 Session 出现在新 Project 树中（generation.session_id 不变） |

---

## UC7 — 删除 Project（MVP）

| 步骤 | 责任方 | 动作 |
|------|--------|------|
| 1 | library | 若存在任何 Session → **409** |
| 2 | 若空 Project | 允许 delete |

**不提供** Session DELETE；不级联删 generation/images。
