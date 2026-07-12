# job-engine 模块 · test

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md, dfd-interface.md
> 文档顺序: ⑦ test(本文)

---

## 1. Test Scope（测试范围）

### 覆盖

- submitGeneration 完整流程（校验 → prompt → db 事务 → provider → storage → 状态更新）
- getGeneration 惰性 poll 推进
- sync（zenmux）与 async（fal）路径
- touchSession、sessionExists 校验
- NormalizedRequest 显式 pick（不含 provider/model/sessionId）
- createImage 完整字段（contentType, sizeBytes, index）
- 并发 GET 幂等与 imageExists 跳过
- 部分转存失败 → failed 且保留已成功 images
- sync provider count > 1 拒绝

### 不覆盖

- providers 内部请求翻译（归属 providers test）
- storage 路径 canonicalize 细节（归属 storage test）
- API 路由 HTTP 映射（API 集成测试）

---

## 2. Critical Scenarios（关键场景）

### 2.1 Submit — Sync 路径（zenmux）

| 场景 | 前置 | 预期 |
|------|------|------|
| 正常文生图 | mock sync images | status=completed，createImage 含 contentType+sizeBytes+index=0 |
| 有 sessionId | session 存在 | touchSession 被调用；session.updated_at 更新 |
| session 不存在 | sessionId 无效 | ValidationError，无 generation 记录 |
| provider 失败 | mock failed | 201 status=failed，storage 未调用 |
| sync count=2 | zenmux | ValidationError |

### 2.2 Submit — Async 路径（fal）

| 场景 | 前置 | 预期 |
|------|------|------|
| 正常 submit | mock async handle | status=pending，providerHandle 非空 |
| submit 失败 | mock failed | status=failed |

### 2.3 Get — 惰性 Poll

| 场景 | 前置 | 预期 |
|------|------|------|
| pending → completed | mock poll completed | storage 调用，createImage 写入 |
| poll failed | mock poll failed | job+generation failed |
| poll cancelled | mock poll cancelled | job+generation cancelled |
| 已完成不 poll | status=completed | provider.poll 未调用 |
| 并发 advance | 两次 advance 同时 | 仅一次 poll；imageExists 防重复 createImage |

### 2.4 部分转存失败

| 场景 | 前置 | 预期 |
|------|------|------|
| 第 2 张 download 失败 | 4 张 refs，第 2 次 storage 抛错 | index 0 的 image 保留；job failed；不再处理 2、3 |

### 2.5 校验

| 场景 | 输入 | 预期 |
|------|------|------|
| seed 不支持 | seed=1，supportsSeed=false | ValidationError |
| negativePrompt 不支持 | 有值，supportsNegativePrompt=false | ValidationError |
| NormalizedRequest 字段 | submit 后 mock 断言 | 不含 provider/model/sessionId |

### 2.6 事务

| 场景 | 验证 |
|------|------|
| createGeneration + createGenerationJob | 同一 transaction；中途失败则两者皆无 |

---

## 3. Integration Points（集成点测试）

| 验证点 | 方式 |
|--------|------|
| storage 返回值写入 createImage | mock 断言 contentType, sizeBytes |
| provider 收到 processedPrompt | mock 断言 |
| poll 使用反序列化 JobHandle | mock 断言 externalId |

---

## 4. Verification Strategy（验证策略）

- 单元测试: mock 四个外部模块
- 集成测试: 内存 SQLite + 真实 transaction
- E2E: curl 见 `docs/mvp/api/quickstart.md`

---

## 自检（提交前）

- 覆盖 constraints.md 中的并发、部分失败、sync count=1 规则
