# library 模块 · goals-duty

> 模块路径: `src/lib/library/`（待实现；本轮先文档后代码）
> 文档顺序: ① goals-duty(本文) → ② architecture → ③ data-model → ④ dfd-interface → ⑤ use-case → ⑦ test
> 修订说明: 2026-07-16 新建。承接 Project / History / Gallery(收藏) / 模型启用偏好。

---

## 1. Design Goals（设计目标）

1. **把「创作资产的组织与浏览」从生成流水线中拆出来**
   - Project / Session 归属、历史列表、收藏画廊、模型启用池，不由 job-engine 承担。
   - 衡量标准: job-engine 仍只负责 submit/advance/转存；History/Gallery/Project CRUD 经 library（及薄 API）完成。

2. **保证「无零散 Session」的硬不变量**
   - 每个 Session 必须属于某个 Project；进 Generate 前必须已选定 Project。
   - 衡量标准: 无法创建 `project_id` 为空的 Session；无法在无 Session 上下文提交 generation（由 API/job-engine 协同强制）。

3. **让 History 与 Gallery 视角清晰分离**
   - History：按 `Project → Session → Generation` 结构化浏览（含看图）。
   - Gallery：仅展示用户收藏的单张 Image，并可追溯到 Job/Generation。
   - 衡量标准: 未收藏的图不出现在 Gallery；收藏记录能解析出 `image → job → generation → session → project`。

4. **让 Models「启用池」与 Generate「当次勾选」解耦**
   - library 持久化「哪些 (provider, model) 进入工作台可选池」；当次扇出选择仍由 web-ui 持有。
   - 衡量标准: 关闭某模型后，工作台可选池不再出现该模型；重新启用后恢复。

5. **实现简单优先，服务本地单用户 MVP**
   - 不做多租户、不做全文搜索、不做复杂权限；列表以时间倒序与简单过滤为主。

---

## 2. Duties（职责）

1. **Project 生命周期**: 创建、列出、更新标题、（MVP 可选）软删除或拒绝删除有内容的 Project。
2. **Session 生命周期（必须挂 Project）**: 在指定 Project 下创建 Session；列出某 Project 的 Sessions；更新标题；支持将会话在 Project 之间移动（迁移 `project_id`）。
3. **History 查询**: 按 Project / Session 返回结构化生成记录（含 generation 摘要、jobs、images 引用）；支持「最近 N 次 generation」供 Generate 首页（默认 N=10）。
4. **Favorite（Gallery）**: 对单张 Image 收藏/取消收藏；列出收藏（时间倒序）；提供详情所需的回溯信息（至少 imageId、jobId、generationId、sessionId、projectId、prompt 摘要、provider/model）。
5. **模型启用偏好**: 读写「已写入的 (provider, model) 启用行」；**无行 = 默认启用**；仅 `enabled=false` 从工作台池剔除；写入时校验 registry。
6. **供 API 层调用的领域服务入口**: 对外以清晰函数/用例 API 提供上述能力；不直接处理 HTTP。HTTP 形状以 `api/constraints.md` §14–§15 为准。

---

## 3. Non-Duties（非职责）

1. **不执行生成、不推进 job、不转存图片**: 归属 job-engine + storage。
2. **不持有厂商 API key、不决定 provider 是否因 key 启用**: 本轮 env + providers registry；后续 user-config。
3. **不渲染 UI**: 归属 web-ui；library 只提供数据与命令。
4. **不做多用户鉴权与租户隔离**。
5. **不把 Generation 的创建权威放在本模块**: generation/job 行仍由 job-engine 写入；library 只读聚合与组织侧写（Project/Session/Favorite/偏好）。
6. **不做「收藏整个 Generation」**: 收藏单位仅为 Image。
7. **不实现 Inbox / 零散 Session**。
8. **不替代 `GET /api/providers` 的能力声明**: 启用池是偏好过滤，capabilities 仍来自 providers。

---

## 自检（提交前）

- **一句话**: library 是创作资产的组织与浏览域——Project/Session、History、Gallery 收藏、模型启用池。
- **不该做**: 生成编排、密钥、UI、多租户。
- **重叠风险**: 与 job-engine——写 generation 仍归 job-engine；与 db——持久化经 db queries，library 不绕过 schema；与 web-ui——仅数据，不抢交互。
