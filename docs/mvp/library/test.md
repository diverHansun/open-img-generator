# library 模块 · test

> 模块路径: `src/lib/library/`
> 前置文档: goals-duty.md, dfd-interface.md, use-case.md
> 遵循项目既有：`*.unit.test.ts` 与模块同列；集成测试在 `tests/integration/`。

---

## 1. Test Scope（测试范围）

**要验证**

- Project/Session CRUD 与「Session 必属 Project」不变量
- History 最近 N 次与按 Session 列表的正确性
- Favorite 幂等、Gallery 回溯字段完整
- Model prefs 与「启用池」过滤语义
- moveSession 后 History 树归属变化

**不验证**

- job-engine 扇出/poll（已有测试）
- 厂商 HTTP
- UI 像素级交互（可用后续 Playwright；非 library 单测职责）

---

## 2. Critical Scenarios（关键场景）

| ID | 场景 | 期望 |
|----|------|------|
| L1 | createSession 时 project 不存在 | 失败，无脏行 |
| L2 | createSession 成功后 listSessions | 仅出现在该 project |
| L3 | 无法表示 projectId=null 的 session | schema/API 层拒绝 |
| L4 | listRecentGenerations(limit=10) | 按时间倒序，条数 ≤10 |
| L5 | addFavorite 两次同一 image | 幂等，仍一条 |
| L6 | listFavorites 含 job/generation/session/project 回溯 | 字段齐全 |
| L7 | setModelEnabled(false) 后 listEnabled | 不含该项 |
| L8 | moveSession 到另一 project | listSessions 源空、目标有；generation 仍同 sessionId |
| L9 | deleteProject 非空 | 拒绝 |

---

## 3. Integration Points（集成点）

| 协作 | 测法 |
|------|------|
| library ↔ db | unit + 真实 SQLite（项目 helpers） |
| api ↔ library | contract/integration：建 project→session→generation 链路 |
| web-ui 门禁 | 集成或 e2e：无 project 不能生成（可后置） |

---

## 4. Verification Strategy（验证策略）

1. **单元**: 每个子文件关键命令/查询 + 不变量。
2. **集成**: `tests/integration/library-history.integration.test.ts`（建议名）覆盖 UC1 片段 + 收藏 + 最近 N 次。
3. **回归**: 现有 fanout/generation 测试在「session 必填」变更后必须更新 fixture。

**完成定义**: L1–L9 有自动化覆盖；README 进度表 library 行勾选完毕。
