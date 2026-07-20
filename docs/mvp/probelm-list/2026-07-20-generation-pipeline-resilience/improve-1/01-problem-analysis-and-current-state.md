# 问题分析与当前状态

> 基线提交：`231774d`（2026-07-20）
> 分析范围：Generate 浏览器交互 → Web Client → Generation API → job-engine → SQLite → Provider → 图片转存 → Stage 恢复
> 性质：棕场现状诊断；本文件描述“现在是什么、为何会失效”，具体改法在 `02-optimization-plan-and-change-scope.md` 冻结。

## 1. 结论摘要

截图中的“提交失败”不是 Provider 密钥、模型参数或网络错误，而是**运行中数据库结构落后于代码**：`createGenerationWithJobs()` 写入 `generation_jobs.next_poll_at` 时，`data/app.db` 尚无该列。事务完整回滚，所以没有残留 Generation/Job/Image，也没有调用 fal 或 ZenMux。

直接故障虽然单一，却暴露出一组互相放大的系统性问题：

1. `dev` / `start` 不执行或校验迁移，`/api/health` 又只做 `SELECT 1`；服务“活着”被误当成“可以接单”。
2. API 层已经具备可选的结构化错误能力，Web Client 也能解析 `code/retryable`，但 Generation POST 没启用该契约，Generate 页面还在无参 `catch` 中丢弃错误对象。
3. POST 同时承担本地建单、全部 Provider submit 和同步图片转存，且没有请求幂等键；响应丢失时客户端无法判断“未创建”还是“已创建但响应没回来”。
4. 任务只持久化 prompt、provider、model 和远端 handle，没有保存可重新派发所需的完整请求快照，也没有显式 dispatch phase；进程若在外部副作用前后崩溃，会产生无法自动辨认或恢复的中间状态。
5. 现有 lease、取消标记和图片唯一键解决了部分并发竞态，但瞬时错误一律终结、取消流程存在崩溃窗口、worker 扫描和指标不表达真实推进结果。
6. Provider 和图片下载已有基础 timeout，却缺少统一 deadline、Retry-After、bounded retry、队列取消、URL/响应大小边界和敏感信息脱敏。
7. Stage 具备共享轮询、终态停止和刷新 URL，但单次 GET 可无限等待，且恢复已知 Generation 仍被 Compose 的 Session/Provider/Preference bootstrap 绑住。
8. 测试覆盖了大量 happy path 与局部竞态，却没有使用“真实旧 schema + 真实启动/readiness”证明部署前提，也没有覆盖响应丢失、dispatch 崩溃检查点和浏览器级恢复。

当前架构不需要拆成微服务。问题主要来自**持久化语义、职责边界和失败契约不完整**，而非模块化单体本身不可用。

## 2. 本次事件的证据链

### 2.1 运行时事实

| 检查点 | 观察结果 | 含义 |
|---|---|---|
| 浏览器 | Generate 页面显示“提交失败，输入和上一项当前任务均已保留” | 前端只知道 POST 抛错，无法展示具体阶段与动作 |
| 服务端堆栈 | `table generation_jobs has no column named next_poll_at` | 失败发生在 SQLite INSERT，不是 Provider adapter |
| 代码 schema | `src/lib/db/schema.ts` 声明 `next_poll_at`、`cancel_requested_at` | 当前代码要求新版 schema |
| 运行库 schema | `data/app.db` 的 `generation_jobs` 缺少上述两列 | 部署/启动状态与源码契约漂移 |
| 数据行 | `generations=0`、`generation_jobs=0`、`images=0` | 创建事务失败后完整回滚 |
| Provider 调用位置 | dispatch 发生在 `createGenerationWithJobs()` 和 `touchSession()` 之后 | 本次错误发生时尚未进入远端调用，不产生费用 |
| 健康接口 | `/api/health` 返回 200、`db: ok` | 当前健康语义未覆盖 schema compatibility |
| 迁移副本验证 | 现有脚本能补齐两列，`foreign_key_check` 通过 | 迁移逻辑存在，但没有成为启动/readiness 的强制前提 |

### 2.2 直接故障路径

```text
Generate submit
  → POST /api/generations
  → submitGeneration()
  → validate()
  → createGenerationWithJobs() 开启事务
  → INSERT generations
  → INSERT generation_jobs(next_poll_at, cancel_requested_at, ...)
  → SQLite: no column named next_poll_at
  → transaction rollback
  → handleApiError() 返回通用 500
  → ApiClientError 被 Generate 无参 catch 丢弃
  → 用户只看到通用提交失败
```

该链路中，数据库回滚保证了本次没有半条本地任务；但 readiness 假阳性和错误信息降级使问题直到用户点击“开始生成”才被发现。

## 3. 当前纵向数据流

### 3.1 提交路径

1. `src/components/generate/generate-screen.tsx` 校验页面输入并构建共享请求。
2. `src/lib/web-client/api-client.ts` 以 JSON POST `/api/generations`；请求没有 signal、deadline、Idempotency-Key 或 `clientRequestId`。
3. `src/app/api/generations/route.ts` 启动可选进程内 worker，解析 body 后同步等待 `submitGeneration()` 完成。
4. `src/lib/job-engine/orchestrator.ts` 全量校验 targets，处理 prompt，生成一个 Generation ID 和 N 个 Job ID。
5. `src/lib/db/queries/generations.ts` 在一个 SQLite transaction 中创建 1 Generation + N Jobs。
6. transaction 提交后 `touchSession()`；随后 `Promise.allSettled()` 并发派发各 target。
7. sync Provider 的结果在 POST 内下载并写入本地存储；async Provider 的 handle 在返回后写入 Job。
8. orchestrator 再读一次聚合状态，API 返回 `201 { id, status, links.self }`。

这条路径把“接受用户意图”和“完成可能较慢、可能产生费用的外部副作用”放在同一个 HTTP 响应窗口内。只要连接在本地建单之后断开，浏览器就无法从 POST 响应判断真实结果。

### 3.2 查询与推进路径

1. Stage 通过 `GenerationPollRegistry` 请求 `GET /api/generations/:id`。
2. `getGeneration()` 发现 Generation 未终结时，对全部 active jobs 执行 `advance(..., force: true)`。
3. 有 handle 的 async job 竞争 poll lease；赢家调用 Provider poll，再以 lease token CAS 写回。
4. worker 开启时也读取 `next_poll_at` 到期 jobs，并复用同一 `advance()`。
5. Provider 完成后，job-engine 下载图片、写 image rows，再聚合 Generation 状态。

当前“读取详情”同时是状态推进命令。它适合早期本地 MVP，但也意味着详情 GET 的延迟、错误和副作用比普通只读 GET 更复杂；Stage 轮询和可选 worker 是两种推进触发器，却共同依赖相同的不完整持久化状态。

### 3.3 取消路径

1. API 读取 Generation 及 active jobs。
2. 每个 Job 先 CAS 写 `cancel_requested_at`。
3. 有远端 cancel 能力和 handle 时调用 Provider；否则生成 warning。
4. 最后写 `cancelled`、清 lease/next poll 并聚合 Generation。

取消标记有效阻止晚到 submit/poll 复活任务；但步骤 2 与步骤 4 之间若进程退出，Job 会保持 active status + cancel marker，且被后续 poll/worker 过滤。

## 4. 七维现状诊断

### 4.1 目标与职责

现有模块文档对主职责定义清楚：API 只调用 job-engine；job-engine 负责编排；Provider adapter 隔离厂商协议；storage 负责本地图片；SQLite 保存业务状态。当前实现也基本遵守依赖方向。

职责缺口主要出现在失败边界：

| 缺口 | 当前没有明确的唯一责任方 |
|---|---|
| schema compatibility | migration 脚本能变更结构，但启动和 health 不负责证明“当前代码可以服务” |
| 请求接纳结果 | API、orchestrator、浏览器均没有持久化幂等身份来判定重复请求 |
| dispatch 恢复 | HTTP submit 线程执行派发，worker 只认识已有 handle 的 poll job |
| retry policy | adapter 产生 `retryable`，job-engine 却不消费该语义 |
| 错误呈现 | error handler、ApiClientError 与页面各保留一部分能力，Generation 链路没有端到端所有者 |
| 敏感信息脱敏 | Provider、storage、DB job error、server log 与 UI 之间没有统一边界 |

因此，正常路径的组件分工清楚，异常路径则出现“每层都做了一点，但没有一层负责闭环”的情况。

### 4.2 架构与模块边界

#### 已有合理结构

- Next.js + SQLite 模块化单体符合当前本地桌面/MVP规模，调用关系短，故障可本地复现。
- Provider registry/adapter 把七家厂商的请求和响应差异隔离在 `src/lib/providers/`。
- lifecycle 与 orchestrator 分开，单 Job 推进与整单聚合已有基本边界。
- generation 与全部 jobs 原子创建，避免 target fan-out 只落一半。
- lease CAS、取消 marker、图片 `(generation_job_id,index)` 唯一性分别覆盖轮询、取消和图片写入竞态。

#### 当前结构性张力

- `orchestrator.submitGeneration()` 同时承担 admission、建单、session touch、外部 submit、sync storage 与最终读取，故障域和响应时间都集中在一个入口。
- 可选 worker 在 API/health 首次请求时进程内启动，既不是强制运行组件，也不是任务接纳的可靠后继者。
- `GET detail` 同时读取和推进，调用方无法区分“展示失败”与“推进失败”；列表接口又刻意只读。
- in-memory generation admission 和 Provider limiter 只对当前进程有效，进程重启后没有排队/attempt事实；limiter queue 无界且不可取消。
- health route 同时承担 worker bootstrap 与连通性检查，却未区分 liveness/readiness。

上述张力并不要求外部队列或微服务；它说明现有单体内部的命令、状态和恢复责任尚未分清。

### 4.3 数据模型与状态

#### 当前持久化概念

| 概念 | 已持久化核心信息 | 当前缺失或模糊的信息 |
|---|---|---|
| Generation | session、processed prompt、聚合 status、时间 | client request identity、请求版本、接纳/dispatch 汇总阶段、故障关联 ID |
| Generation Job | provider、model、status、handle、error、poll lease、next poll、cancel marker | 完整 normalized request snapshot、dispatch phase、attempt 计数、next attempt、deadline、结果未知语义 |
| Image | job、index、storage path、元数据 | 下载来源的安全摘要/校验结果、转存阶段/补偿状态 |

`SubmitGenerationParams` 中的 mode、width、height、aspectRatio、count、negativePrompt、seed、referenceImages 和 providerOptions 没有形成可恢复快照。进程在建单后退出时，数据库只知道“要让某 provider/model 生成 processed prompt”，不足以重建原请求。

#### 当前状态表达不足

对外和 DB 均只有 `pending/running/completed/failed/cancelled`。这个集合适合表达用户可见聚合结果，却无法区分：

- 已接纳但未派发；
- 正在派发且远端是否可能已接受未知；
- 已获取 handle、等待 poll；
- 正在转存图片；
- 已请求取消、等待本地收口；
- 瞬时失败、等待下一次 attempt；
- Provider 结果未知、不可安全自动重投。

同一个 `pending` 因而承载多个恢复语义。`listDueGenerationJobs()` 又只选择 `provider_handle IS NOT NULL`，所以 `pending + handle=null` 不会被 worker 恢复。现有 poll 还允许 Provider 返回 `running` 后再次写 `pending`，状态对用户并非单调。

### 4.4 数据流与接口契约

#### API 错误契约不连续

- `handleApiError()` 已支持 `{ error: { code, message, retryable } }`，但仅在调用方传 `structured: true` 时启用。
- Generation POST/detail/cancel 当前使用默认模式，非 500 返回字符串，500 返回通用文本；没有 correlation/request ID。
- `ApiClientError` 能解析结构化 body，但页面 submit 的 `catch {}` 不接收异常。
- job error 内部使用 JSON 字符串，部分字段来自第三方自由文本，最终可能直达 UI。

因此“后端知道的错误类别”没有稳定地穿过 API → client → i18n → 用户动作。

#### 提交结果存在歧义

POST 没有幂等键，而 Generation ID 只在服务端生成并在流程末尾返回。以下两种情况在浏览器端表现相同：

1. 请求在本地 transaction 前失败，什么都没创建；
2. Generation 已创建，甚至 Provider 已接单，但 HTTP 响应超时或丢失。

客户端若重试，情况 1 需要新建；情况 2 却可能重复建单和收费。当前契约没有查询同一用户意图的方式。

#### 内部失败可能被降格

- submit/get 使用 `Promise.allSettled()`，但不检查 rejected 结果。
- `submitTargetSafely()` 尝试把异常转成 Job failed；若这次 DB 写本身失败，外层 allSettled 仍可能被忽略。
- `touchSession()` 在建单 transaction 之后、Provider submit 之前执行；它失败会让已创建 Job 永久停在无 handle pending。
- worker 将 `advance()` Promise fulfilled 计为 succeeded，即使 advance 内部把 Job 写成 failed。

当前调用成功/失败指标与领域任务是否真正推进并不等价。

### 4.5 关键用例与异常分支

| 用例 | 当前正常行为 | 当前异常行为/空洞 |
|---|---|---|
| 单模型 sync 生成 | 建单、submit、下载、completed 后返回 | POST 长时间占用；响应丢失无法找回意图；空图片也可能完成 |
| 多模型 fan-out | 1 Generation + N Jobs，并行 submit，允许部分成功 | 默认可自动选多模型，意外扩大调用数/费用；单请求包含多个独立故障窗口 |
| async 生成 | 保存 handle，Stage/worker poll，完成后转存 | handle 落库前崩溃不可恢复；poll 瞬时错误直接 failed |
| 刷新 Stage | URL 中 generation id 可重新订阅 | 必须先完成 Compose bootstrap；任一依赖失败阻塞已知任务 |
| 重复点击 | ref guard 阻止同一挂载中的快速双击 | 响应未知、路由变化或刷新后没有服务端去重 |
| 取消 | marker 防止晚到结果复活，尽力远端 cancel | marker 后崩溃会悬挂；远端取消失败没有恢复 attempt |
| 并发 poll | lease CAS 只有一个赢家，旧响应不可覆盖新 lease | due scan 不排除有效 lease且无稳定排序，前部占位可能饿死后续任务 |
| 图片落库 | `(job,index)` 幂等，竞争失败清理临时文件 | 下载/文件写入发生在最终 lease/cancel CAS 前，失败竞态可能遗留副作用 |

### 4.6 非功能属性

#### 可靠性与一致性

- **已有保证**：建单事务、Job+Generation 聚合事务、poll lease CAS、取消 marker、image 唯一键。
- **缺失保证**：接纳幂等、dispatch 恢复、bounded retry、cancel recovery、schema readiness、终态不可逆的统一状态转换表。
- 系统目前更擅长防“两个请求同时写”，不擅长处理“一个请求执行到一半进程消失”。

#### 性能与成本

- POST 等待多 target submit 和 sync storage，尾延迟随最慢 target/图片下载放大。
- Provider limiter 限制 active 数，但 queue 无上限、没有排队 deadline 或 abort，压力下只会把等待转移到内存。
- Stage 最大轮询间隔只有 5 秒且无 jitter；多个页面或客户端可形成同步请求波峰。
- 默认选中最多八个模型，交互默认值可直接放大 Provider 费用。

#### 安全与隐私

- storage 接受 Provider 返回的任意非-data URL，自动跟随 fetch redirect；未限制协议、私网目标、响应体大小、Content-Type 或图片 magic bytes。
- fal 等 adapter 若复用带认证的状态 URL，需要确保不把 credential 发往 Provider 可控的任意 host；当前边界没有集中验证。
- `StorageError` 会把完整下载 URL写入 message，签名 URL query 可能继续进入 Job error、日志或 UI。
- 技术错误也可能包含第三方响应文本；缺少统一 redaction。

#### 可观测性

现有主要是 `console.error` 文本。一次请求无法稳定关联 client request、Generation、Job、Provider、phase、attempt、耗时和错误类别；也无法从 worker 返回值判断“扫描到了但业务失败”的数量。schema drift 只在用户流量进入后出现，更说明部署与运行指标没有形成早期反馈。

### 4.7 测试与验证现状

#### 已有覆盖

- Unit：validator、orchestrator、lifecycle、cancel、worker、DB query、storage、七家 Provider adapter、limiter、Web Client 和 poll registry。
- Contract：Generation route 的基本成功、校验、not-found、cancel，以及 health 的响应形状。
- Integration：sync、async、fan-out、前端数据链路；临时 SQLite 和 mock/MSW Provider。
- Smoke：build、db migrate、db push、health。

这些测试已经证明正常状态机、fan-out 部分失败、lease 竞争、取消晚到响应、图片唯一键等局部机制有效。

#### 关键空洞

1. migration smoke 没有从“已有业务表但缺当前新增列”的真实上一版本 schema 升级，并断言 required columns/version。
2. health contract 只验证 `SELECT 1` 语义，所以真实 DB 不兼容时测试仍绿。
3. 测试 helper schema 与生产迁移脚本是两份结构事实，helper 直接创建最新 schema，掩盖升级路径漂移。
4. 没有重复/并发 Idempotency-Key、响应丢失后重放、payload 冲突的 contract/integration 场景。
5. 没有 create 后、Provider accept 后、handle persist 前、cancel marker 后、图片写入后的崩溃检查点。
6. 没有 retry budget、backoff、jitter、Retry-After、进程重启和 stale dispatch recovery。
7. 没有外部 URL trust boundary、超大 body、非图片响应、redirect/credential leakage、日志脱敏测试。
8. `test:e2e:backend` 当前允许无测试通过；项目测试蓝图明确浏览器 E2E 尚未纳入自动化，而本次用户要求最终执行 E2E。
9. 没有真实 Next HTTP 服务下的 Generate 提交 → Stage 恢复 → 终态链路。

所以当前测试对“代码按预期运行”有较好信心，对“旧数据升级、进程崩溃和网络结果不确定时仍可恢复”信心不足。

## 5. 现有保护机制：应保留而非推倒重来

| 机制 | 位置 | 已解决的问题 |
|---|---|---|
| 1 Generation + N Jobs 原子创建 | `createGenerationWithJobs()` | fan-out 建档中途失败不会只留下部分 targets |
| Job 写回与 Generation 聚合事务 | `updateJobAndGeneration*()` | 子任务状态和聚合状态尽量同步 |
| poll lease + token CAS | `tryClaimPollLease()` / `updateGenerationJobIfLease()` | 并发详情 GET/worker 只有赢家写回，旧响应不可覆盖新 lease |
| cancel marker guard | `cancel_requested_at` 条件写 | 取消后晚到 submit/poll 不复活本地任务 |
| image 唯一键 | `(generation_job_id,index)` | 同一结果重复转存不会产生重复 image row |
| loser file cleanup | storage/lifecycle | 唯一键竞争失败时清理多余文件 |
| Provider 间隔离 | target 级 safe submit + 聚合 | 一家失败不必回滚其他已成功 Provider |
| 前端 submit guard/sequence | `generate-screen.tsx` | 同一挂载内双击与过期响应不会覆盖最新 UI |
| 共享 poll registry | `poll-registry.ts` | 同一运行时多个订阅者共享一个详情轮询，最后退订时 abort |
| 单调快照合并与终态停止 | Generate task state/Stage | 旧快照不覆盖新终态，完成后停止轮询 |

改造应围绕这些已验证机制补齐前后边界，而不是改成另一套通用任务框架。

## 6. 文档与实现的偏差

| 文档约定 | 当前实现/运行事实 | 偏差影响 |
|---|---|---|
| DB 文档包含 `next_poll_at`、`cancel_requested_at` | 运行库缺列 | 文档与 TypeScript 一致，但部署状态未对齐 |
| job-engine 文档明确单次失败、不重试 | adapter 已标 `retryable`，但 engine 总是终结 | retryable 是装饰字段，用户无法获得瞬时恢复 |
| architecture 承认未持久化完整运行参数 | 实现确实只保存 prompt/provider/model | worker 无法恢复未派发 job |
| health 表示 `db: ok` | 只验证连接，不验证结构 | 调用方误把 liveness 当 readiness |
| Web Client 已有结构化 ApiClientError | Generation route 默认非结构化；页面丢弃异常 | 契约能力没有形成端到端体验 |
| 测试蓝图将 E2E 定义为后续、浏览器仅人工 | 用户本批明确要求 unit/integration/E2E | 当前质量门禁不足以满足本次交付 |

## 7. 风险地图

以下 ID 是 `02` 方案和 `04` 验收的追踪主键。

| ID | 问题 | 触发条件 | 用户/系统影响 | 严重度 |
|---|---|---|---|---|
| P-01 | schema drift 无 readiness 门禁 | 代码升级但运行库未迁移 | 所有生成请求 500，health 仍绿 | Blocker |
| P-02 | Generation 错误契约和 UI 信息丢失 | 任意提交/详情/取消错误 | 用户无法判断原因、是否重试或如何修复 | High |
| P-03 | 提交无本地幂等与结果判定 | 双击跨刷新、响应丢失、客户端重试 | 重复 Generation、重复 Provider 调用/费用 | Critical |
| P-04 | dispatch 意图和请求快照不持久 | 建单后退出，或 submit 接受后 handle 未写入 | 永久 pending 或结果未知，无法安全恢复 | Critical |
| P-05 | cancel marker 与终态之间有崩溃窗口 | 标记后进程退出/DB 写失败 | active 状态被永久排除于推进 | High |
| P-06 | retryable 不驱动有界恢复 | 429、5xx、timeout、短时网络故障 | 可恢复任务过早 failed；用户手动重建放大成本 | High |
| P-07 | 编排内部 failure 被 allSettled/touch 边界弱化 | Job 写回失败、touchSession 失败 | API 可能返回陈旧状态或留下无 handle job | High |
| P-08 | 状态表达与 worker 公平性不足 | running→pending、有效 lease 占 batch、无排序 | UI 回退、任务饥饿、指标误报 | Medium |
| P-09 | 图片完成/补偿边界不完整 | 空结果、数量不符、取消/lease 失效后转存 | 假 completed 或文件/row 残留 | High |
| P-10 | Provider/storage trust boundary 不足 | 恶意/异常 URL、redirect、超大或非图片响应 | SSRF、credential/签名 URL 泄漏、磁盘/内存压力 | Critical |
| P-11 | Stage 恢复与轮询韧性不足 | Compose bootstrap 失败、GET 挂起、离线/后台 | 已有任务无法查看，轮询永久停住或形成波峰 | High |
| P-12 | fan-out 与参数能力语义可能误导 | 默认多模型、seed 仅部分支持 | 意外多次付费，结果跨 Provider 不可比 | Medium |
| P-13 | 缺少关联日志和领域指标 | 任意跨层失败 | 难以定位阶段、attempt、费用与恢复结果 | High |
| P-14 | 测试未覆盖部署/崩溃/E2E | 真实旧库、进程退出、HTTP 服务链路 | 测试绿但生产不可生成 | Critical |

## 8. SWE 原则评估

### 8.1 复杂度与可理解性

现有实现规模可控，模块边界也大体可理解；主要复杂度是隐式的：一个 `pending` 表示多种阶段，一个 HTTP POST 隐含多种副作用，一个 `retryable` 字段没有执行含义。与其增加更多 catch 和布尔字段，更需要把已经存在的生命周期事实显式化。

### 8.2 反馈周期

当前最快反馈是用户点击 Generate 后才发现 schema drift。迁移、readiness 和真实升级 smoke 未形成部署前反馈。代码层已有大量 Vitest，是良好基础，但测试样本偏向“最新 schema + 当前进程不崩溃”。

### 8.3 变更安全

好的局部保护已经存在：transaction、CAS、unique constraint、typed provider result。风险来自跨保护区的缝隙，尤其“transaction commit → 外部副作用 → handle persist”和“文件写入 → DB/CAS”。后续变更必须把这些检查点作为测试边界，不能只增加 happy path 代码覆盖率。

### 8.4 过度设计风险

当前不需要事件溯源、CQRS、通用 saga 框架或外部队列。七家 Provider 的能力确实不同，也不能用一个假装完全统一的 retry/幂等抽象抹平差异。合理方向是在现有单体中增加少量明确的持久化事实、状态转换策略和错误分类。

### 8.5 假设与事实分离

- 已证实：本次 500 来自缺列；事务回滚；Provider 未调用；迁移副本可成功。
- 代码可证：POST 无 idempotency；request snapshot 不完整；worker 不扫描无 handle job；Generate 丢弃异常。
- 需在方案/实施前逐家确认：Provider submit 是否支持 idempotency、查询或可靠取消。
- 需通过故障测试验证：进程检查点恢复、storage 补偿和 E2E 实际行为。

## 9. 改动影响面

后续方案至少会触及以下边界；此处只列现状影响面，不冻结具体文件新增方式。

| 领域 | 现有主要位置 |
|---|---|
| schema/migration/readiness | `src/lib/db/schema.ts`、`scripts/migrate-db.mjs`、DB client、`src/app/api/health/route.ts`、package scripts |
| Generation API/error | `src/app/api/generations/**`、`src/app/api/error-handler.ts`、request body helpers |
| DB query/state | `src/lib/db/queries/generations.ts`、images query、schema/test helper |
| job-engine | `orchestrator.ts`、`lifecycle.ts`、`worker.ts`、`admission.ts`、`types.ts` |
| Provider | `http-client.ts`、`limiter.ts`、七家 adapters、provider result/error types |
| storage | `src/lib/storage/index.ts`、cleanup 与 image serving |
| Web Client | `api-client.ts`、`poll-registry.ts`、request/task state 与 types |
| Generate UI/i18n | `generate-screen.tsx`、`generate-stage.tsx`、Generate message catalog |
| tests | co-located unit、Generation/health contract、generation integration、migration/health smoke、新 backend/browser E2E |
| 权威文档 | `docs/mvp/db/`、`api/`、`job-engine/`、`providers/`、`web-client/`、Generate 页面文档、`docs/test-blueprint.md` |

## 10. 诊断完成标准

- 根因、未产生 Provider 调用/费用和当前运行库状态有直接证据。
- 正常提交、推进、取消、图片转存和前端恢复的数据流均已覆盖。
- 已区分现有有效保护与尚未闭环的风险，不以重写架构代替修复。
- P-01 至 P-14 能分别追踪到 `02` 的方案项和 `04` 的验收场景。
- 对 Provider idempotency 等未核实事实明确标记为待确认，不将推测写成保证。

下一文档 `02-optimization-plan-and-change-scope.md` 将对每个风险 ID 给出候选方案、推荐选择、schema/API/state/retry/security 设计、实施批次、兼容与回滚边界。
