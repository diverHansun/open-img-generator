# MVP 文档跨模块对齐审查

> 初版审查: 2026-07-10
> 二次审查（并行子代理）: 2026-07-12
> 文档修复: 2026-07-12
> 范围: docs/mvp/ 全部模块文档 + docs/mvp/api/

---

## 1. 文档清单

| 模块 | 文档 | 状态 |
|------|------|------|
| providers | goals-duty, architecture, data-model, dfd-interface, test | 完成 |
| job-engine | goals-duty, architecture, dfd-interface, test | 完成（2026-07-12 修复） |
| storage | goals-duty, dfd-interface | 完成（2026-07-12 修复） |
| db | data-model | 完成（2026-07-12 修复） |
| prompt | goals-duty | 完成 |
| api | constraints, quickstart | 新增 2026-07-12 |

---

## 2. 审查结论（两阶段）

### 2.1 结构一致性: 通过

- 模块职责边界无重叠
- 跨模块类型契约由 providers/data-model 统一定义
- 运行时入参 vs DB 持久化边界明确（db §3.0–3.4）
- sync/async 主数据流完整

### 2.2 运行时语义: 已通过文档修复闭合

2026-07-12 修复项（原并行审查 P0/P1）:

| 项 | 修复位置 |
|----|----------|
| touchSession 接入 submit | job-engine/dfd-interface §2.1 步骤 4 |
| createImage 完整字段 + index 幂等 | job-engine/dfd-interface §2.6, §3.1；db §2.4 |
| NormalizedRequest 显式 pick | job-engine/dfd-interface §2.1 步骤 5, §3.1 |
| cancelled 聚合 + GenerationView 枚举 | db §2.2；constraints §8；job-engine dfd |
| GET sessions 嵌套 poll | job-engine/dfd-interface §2.4 |
| 移除 getPublicUrl 歧义 | job-engine dfd §2.5；storage dfd |
| POST 201 status 含 failed | job-engine/dfd-interface §2.1 |
| 无效 sessionId → 400 | job-engine dfd §2.1, §3.2 |
| seed/negativePrompt 校验 | job-engine dfd §2.1 |
| updated_at 更新规则 | db §2.2–2.3；constraints §7 |
| 并发 GET 乐观锁 + 幂等 | architecture §4.5；constraints §4 |
| 部分转存失败语义 | dfd §2.6；constraints §5 |
| sync count=1 | constraints §3；validator |
| poll 客户端契约 | constraints §2 |
| localhost-only | constraints §1 |
| generation+job 事务 | architecture §4.7；constraints §6 |
| API 骨架对齐说明 | job-engine/dfd §5 |
| providers JobResult 术语 | goals-duty 修正 |

**可以进入编码阶段。**

---

## 3. 数据流（修复后）

### Sync（zenmux）

```
POST /api/generations
  → validate（含 sessionExists, sync count=1）
  → prompt.process
  → db.transaction(createGeneration + createGenerationJob)
  → touchSession（若有 sessionId）
  → provider.submit(NormalizedRequest)
  → storeImages → createImage({..., contentType, sizeBytes, index})
  → 201 { status: "completed" }
```

### Async（fal）

```
POST /api/generations → 201 { status: "pending", links.self }
GET /api/generations/:id（客户端轮询）
  → advance（乐观锁）→ poll → storeImages → 200 { status: "completed" }
```

---

## 4. 编码前检查清单

- [ ] `npm install`
- [ ] 配置 `.env`（FAL_KEY / ZENMUX_API_KEY）
- [ ] `git init`（若尚未）
- [ ] 删除或忽略 `src/app/api/sessions/[id]/gen/` 占位
- [ ] 创建 `src/lib/job-engine/`
- [ ] 选定测试框架（建议 vitest）并写入 package.json
- [ ] 实现 `GET /api/health`

---

## 5. 建议编码顺序

1. db（schema + queries，含 transaction、imageExists、sessionExists）
2. prompt（透传）
3. storage（local + path canonicalize）
4. providers（types + registry + fal/zenmux adapters）
5. job-engine（validator + lifecycle + orchestrator）
6. API routes（按 dfd-interface §5 路由表）
7. 垂直切片：按 [api/quickstart.md](./api/quickstart.md) 验证两条路径

---

## 6. 已知 MVP 限制（by design）

- 无 auth、无 rate limit（localhost-only，见 constraints §1）
- 不持久化 width/count/seed 等输入参数
- 无 list generations 端点
- 无 cancel API
- 无自动重试
- sync provider count=1
- 部分转存失败不自动续传

---

## 7. 剩余非阻塞项

| 项 | 说明 |
|----|------|
| 测试框架 | 编码首批确定 vitest |
| OpenAPI spec | 可选，quickstart 已覆盖 curl |
| 根目录 README | 编码时可从 quickstart 提炼 |
| completed 后清空 provider_handle | 可选优化 |
