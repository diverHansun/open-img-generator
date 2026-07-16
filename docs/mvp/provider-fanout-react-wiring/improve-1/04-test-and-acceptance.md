# 测试与验收标准

> 遵循项目级 [test-blueprint.md](../../../test-blueprint.md)：Vitest；单模块测试 co-located，API contract 位于 `tests/contract/`，跨模块验证位于 `tests/integration/`，真实 Provider HTTP 始终用 MSW 替换。

## 1. 测试范围

- **Unit**：Fal 比例映射、target 校验、参数归一化、状态聚合、lease claim 条件、React capability/轮询纯逻辑。
- **Contract**：POST `targets[]` 的 201/400 行为，GET GenerationView 的 job/error/images 形状，Provider capability 响应。
- **Integration**：临时 SQLite + storage + MSW 运行 Fal async、ZenMux sync、二者 fan-out、并发 GET 与 lease 恢复。
- **Smoke**：既有 health、DB schema 更新、Next build；不调用真实厂商。

## 2. 关键场景

| ID | 场景 | 类型 | 验证点 | 对应 Phase |
|---|---|---|---|---|
| T1 | N jobs 原子创建 | unit/integration | target 数量与 job 数量一致；任一插入失败不留下 generation | 1 |
| T2 | Fal 公共比例 | unit | `1:1`→`square_hd`、`16:9`→`landscape_16_9`；没有静默固定正方形 | 1 |
| T3 | 状态聚合 | unit | running 优先；全终态含 completed+failed→completed；无 completed 的 failed/cancelled 按契约聚合 | 1 |
| T4 | lease 并发 claim | integration | 同时两个 GET 仅一次 provider.poll；真实 status 不被 claim 修改 | 1/2 |
| T5 | lease 过期恢复 | unit/integration | 未清理 lease 超时后可再次 poll；未到期不能 claim | 1/2 |
| T6 | targets 校验 | unit/contract | 空、重复、未启用、模型不存在、不共享比例、sync count>1 均为 400 | 2 |
| T7 | seed/negativePrompt | unit | ZenMux target 缺少 seed 而 Fal 保留；任一 target 不支持 negativePrompt 时整体拒绝 | 2 |
| T8 | Fal + ZenMux fan-out | integration | POST 产生两 jobs；sync 结果立即保存；async 后续 GET 转存；结果按 job 关联 | 2 |
| T9 | 部分成功 | integration/contract | 一条 failed、一条 completed 时 HTTP view 为 completed，失败 error 保留 | 2 |
| T10 | React capability 交集 | unit | 多选 Fal/ZenMux 仅得 `1:1`；count/seed/negativePrompt 按能力规则推导 | 3 |
| T11 | React polling controller | unit | 非终态退避 poll；全 job 终态停止；取消后不再请求 | 3 |
| T12 | 秘密边界 | static/manual | 新增客户端目录不含 `process.env`、`NEXT_PUBLIC_*`、Provider URL 或 key | 3/4 |

## 3. 集成边界

| 边界 | 真实实现 | fake / mock |
|---|---|---|
| job-engine ↔ SQLite | Drizzle + 每例临时 SQLite | 无 |
| job-engine ↔ storage | 临时目录与真实 download/store 接口 | 图片下载 URL 由 MSW 返回 |
| Provider adapters ↔ HTTP | adapter request/response 解析 | MSW 拦截 Fal、ZenMux |
| React client ↔ Next API | `fetch` 调用与 DTO 解析 | unit 中注入 fake fetch / fake clock |

## 4. 回归清单

- 单 Fal 异步请求仍可从 pending/running 到 completed 并读取 `/api/images/:id`。
- 单 ZenMux 同步请求仍在 POST 返回后完成。
- Session touch、Session generation 列表、health 与 providers 端点保持可用。
- 任何终态 generation 的 GET 不触发新的 provider.poll。
- 无 key 时 `/api/providers` 仍返回空数组，且不会创建 adapter 或泄漏配置。

## 5. 发布门

| 门槛 | 通过标准 | 验证方式 |
|---|---|---|
| 类型 | 无 TypeScript 错误 | `npm run typecheck` |
| 行为 | T1–T11 对应测试通过 | `npm test` 或分类 Vitest 命令 |
| 构建 | Next 生产构建成功 | `npm run build` |
| 文档 | MVP 契约明确 `pollLeaseUntil`，不再把 running 当锁 | `rg "pollLeaseUntil|pending.*running" docs/mvp` 人工复核 |
| 密钥 | `.env` 保持被忽略；无真实 key、无客户端环境变量 | `git status --short` 与静态搜索 |
| 视觉范围 | 不新增 UI/CSS/page 组件 | `git diff --name-only` 人工复核 |

## 6. 对抗性审查

| 攻击面 / 失败模式 | 防御 | 残余风险 |
|---|---|---|
| 两个浏览器同时轮询 | SQL 原子 lease claim | 租约过期时极慢请求可能重叠；Provider poll 必须幂等或容错 |
| 进程在 poll 中崩溃 | 过期 lease 可恢复 | 无后台 worker，直到下一次 GET 才恢复 |
| 一个 Provider 返回失败 | job 级错误与部分成功聚合 | 用户仍需从 job 行理解失败原因，属于后续 UI 职责 |
| 恶意客户端绕过前端限制 | 服务端逐 target validation | `providerOptions` 若以后开放，需要额外白名单 |
| 密钥进入浏览器或仓库 | server-only registry、`.env` ignore、静态搜索 | 本地开发者仍需自行保护 `.env` 文件 |
