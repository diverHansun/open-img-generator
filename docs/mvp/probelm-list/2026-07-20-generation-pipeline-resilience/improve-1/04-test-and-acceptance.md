# 测试与验收标准

> 验收对象：`02-optimization-plan-and-change-scope.md` 定义的 Batch A–F
> 项目级规则：以 `docs/test-blueprint.md` 为基础；本批不新增一次性 E2E runner，浏览器验收按用户显式授权使用本会话启动的真实 Next 与真实 Provider。
> 原则：测试围绕 P-01…P-14 的风险与副作用，不以覆盖率数字、测试数量或“没有抛错”代替可信行为。

## 1. 验收结论的定义

只有同时满足以下条件，图片生成鲁棒性 improve-1 才可判定完成：

1. 截图对应的旧 schema 在副本和真实本地库上均完成安全迁移；未迁移库明确 not ready，不能接纳 Generation。
2. 相同用户意图的重复、并发和响应丢失重放只产生一个 Generation，且同键异 payload 被拒绝。
3. create、dispatch、handle persist、poll、result snapshot、storage、cancel 的关键崩溃检查点均通过自动化测试，恢复或结果未知语义与 `02` 一致。
4. submit 不盲目重投结果未知请求；poll/cancel/download 的重试具有分类、预算、退避与 jitter。
5. Provider/远端图片不可信边界、敏感信息脱敏和资源上限通过对抗性测试。
6. Generate 可显示可行动的中英文错误；已知 Generation 的 Stage 可独立恢复，单次请求不会无限挂起。
7. unit、contract、integration、smoke、typecheck、production build 全部通过；真实 Provider 浏览器 live flow 完成 submit → Stage → image → preview → favorite → refresh → Gallery，且不以空 E2E suite 冒充验证。
8. 多个只读子代理复审后无未处理的 Blocker/High；Medium 若暂缓必须有明确残余风险、负责人语义和后续触发条件。

## 2. 测试分层与边界

| 层级 | 本批验证重点 | 真实执行 | 替换边界 | 目标时长 |
|---|---|---|---|---|
| Unit | canonical hash、state transition、retry policy、schema checker、adapter mapping、URL/bytes policy、intent/error/poll state | 单个被测模块；必要时内存 SQLite | clock/RNG/DNS/fetch/直接依赖用 typed fake | 全套 < 30s |
| Contract | Health/Generation HTTP status、DTO、headers、stable error codes、202/replay/conflict/cancel | Next route handler、Request/Response 转换 | job-engine/DB 可 fake，但契约层真实 | 全套 < 60s |
| Integration | job-engine + SQLite + storage + Provider HTTP 协作；迁移和崩溃 checkpoint | 临时 SQLite 文件、真实 transaction、真实临时文件、MSW | 仅 vendor HTTP/DNS 等不可控外部边界 | 全套 < 3min |
| Live browser E2E | 用户从 Generate submit 到 Stage、刷新恢复、预览/收藏/图库 | 本会话启动的真 Next、当前本地 DB/storage、用户已配置且明确授权的真实 Provider | 不进入 CI；每次只选一个模型、count=1，避免意外 fan-out | 受 Provider 时延影响 |
| Smoke | build、migration、startup/readiness、数据库前提 | 命令/进程/临时文件 | 不替换核心基础设施 | 全套 < 5min |
| Manual | 文案可读性、中英文动作、unknown/partial 视觉语义 | 本地浏览器 | 除上述受控 live flow 外不产生额外真实调用 | 10–15min |

### 2.1 测试目录与命名

保留现有混合策略：

```text
src/**/<subject>.unit.test.ts
tests/contract/<subject>.contract.test.ts
tests/integration/<subject>.integration.test.ts
tests/smoke/<subject>.smoke.test.ts
```

- 不为本轮受控浏览器验收新增 Playwright 依赖、fake Provider server 或固定脚本。
- 不批量移动无关旧测试；修改到的 integration 若仍直接覆盖 `global.fetch`，按现有测试蓝图迁到 MSW。

### 2.2 测试数据和时间

- 每个 integration 文件独立创建临时 DB 和 storage，清理 `.db/-wal/-shm`、图片目录和临时 env。
- clock、random jitter、UUID 通过生产可用的依赖参数或纯函数输入控制；不在生产代码增加 test-only route/flag。
- async test 使用 fake timer 时必须推进到明确状态并恢复 timer；不得真实 sleep 等退避。
- 自动化禁止读取用户真实 `.env` key，禁止真实 fal/ZenMux 等付费调用；只有用户显式授权的 live browser flow 由正常应用进程读取既有配置，验收记录不得输出 key 或签名 URL。

## 3. Unit 测试矩阵

| ID | 场景 | 主要断言 | 建议位置 | 对应 |
|---|---|---|---|---|
| U-01 | required schema 完整 | version、表、列、index 均兼容才 ready | `src/lib/db/compatibility.unit.test.ts` | P-01/A |
| U-02 | version 对但缺列/index | 返回 `SCHEMA_NOT_READY` 和缺失项；不因 `SELECT 1` 通过 | 同上 | P-01/P-14/A |
| U-03 | canonical payload 稳定 | object key 顺序不同 hash 相同；targets 顺序、null、有效输入变化 hash 不同 | `src/lib/job-engine/idempotency.unit.test.ts` 或邻近模块 | P-03/C |
| U-04 | clientRequestId 校验 | 缺失/非法/headers-body 不一致被拒绝 | validator/route unit 或 contract | P-03/C |
| U-05 | phase transition table | 仅允许 `02 §3.5` 的边；terminal/unknown 不可离开 | `state-machine.unit.test.ts` | P-04/P-08/D |
| U-06 | user status 单调 | running 后 pending poll 不回退；terminal 晚到结果无效 | lifecycle/state unit | P-08/D |
| U-07 | aggregate/partial/unknown | active 优先；完成+失败为 completed/partial；unknown 不被当普通可重试失败 | generation query/status tests | P-08/P-09/D/F |
| U-08 | retry classifier | queue/pre-send timeout/abort 为 `not_started` 可重排；明确 429 为 `rejected`；HTTP started 后 timeout/reset/未知 5xx 为 `unknown`；poll 5xx/timeout retryable | retry policy/provider tests | P-06/E |
| U-09 | retry schedule/runtime guard | D2：attempt/elapsed cap、full jitter 下界/上界、损坏 state 与畸形 poll/cancel result 安全收口、成功重置；Retry-After 留 E | `retry-policy.unit.test.ts`、lifecycle/cancel unit | P-06/D/E |
| U-10 | retry exhaustion | poll 第 6 次、cancel 第 3 次 retryable failure 写稳定终态且不再 due；E1 的 safe submit 最多总计 3 次，只有 `not_started`/retryable `rejected` 可进入该预算 | lifecycle/cancel unit | P-06/D/E |
| U-11 | provider limiter | queue 上限快速拒绝；排队 deadline/AbortSignal 移除 item 且 Provider HTTP 0 调用；不同 provider 不互阻 | `limiter.unit.test.ts` | P-06/P-08/E |
| U-12 | 七家 adapter error mapping | 429/4xx/5xx/timeout 的 code/retryable/disposition/Retry-After 一致；普通 Provider JSON > 2 MiB 被流式中止且 raw body 不泄漏 | 各 adapter/http-client unit | P-06/P-10/E |
| U-13 | dynamic Provider URL auth | Fal 仅接受 exact configured origin 且 manual redirect；Qwen/Kling 从 base + external ID 重建；cross-origin 不请求/不转发 Authorization | fal/qwen/kling adapter tests | P-10/E |
| U-14 | remote URL policy | 拒绝非法 scheme、userinfo、loopback/private/link-local/mapped IPv6、过多 redirect | storage policy unit | P-10/E |
| U-15 | image bytes policy | 空 body、>25MiB、Content-Type/magic 不符、GIF/SVG/HTML 拒绝；仅 PNG/JPEG/WebP 通过 | storage unit | P-09/P-10/E |
| U-15A | Base64 staging | ZenMux data URL 解码后执行 25 MiB/type/magic 限制，snapshot 仅 opaque staging ref；Doubao 意外 Base64 走同路径；清理覆盖终态/取消/失败 | storage/adapter unit | P-09/P-10/E |
| U-16 | signed URL redaction | pathname/query/fragment/token 不出现在 exception/structured log；当前 storage 不记录 URL，未来关联日志最多 origin + digest | storage/observability unit | P-10/P-13/B/E |
| U-17 | submit intent 生命周期 | 同 payload 复用 key；输入变化/过期/project-session 变化生成新 key；成功后清理 | Web Client intent unit | P-03/F |
| U-18 | ApiClientError | 解析 code/retryable/requestId/Retry-After；兼容旧 string body | `api-client.unit.test.ts` | P-02/B |
| U-19 | code → i18n/action | 中英文 keys 齐全；unknown 不提供盲目新建动作 | Generate error mapping/i18n tests | P-02/P-11/B/F |
| U-20 | poll registry deadline/state | timeout 会 abort 并 schedule jitter；offline/hidden 暂停；6 次后 pause；manual resume | poll registry unit | P-11/F |
| U-21 | capability intersection | 任一 target 不支持 Seed 则禁用并拒绝发送；默认只选一 model | capabilities/Generate state unit | P-12/F |
| U-22 | worker counters | fulfilled-but-domain-failed 计入 failed/unknown，不计 succeeded | worker unit | P-08/P-13/D |

## 4. Contract 测试矩阵

| ID | HTTP 场景 | 预期契约 | 建议文件 | 对应 |
|---|---|---|---|---|
| C-01 | `GET /api/health/live` | DB schema 坏也返回 200，仅 `{status:ok}`，不启动 worker | `health-api.contract.test.ts` | P-01/A |
| C-02 | ready health（Batch A） | 200、schema/current version、enabled providers；不提前要求 correlation header | 同上 | P-01/A |
| C-02A | health correlation（Batch B） | live/ready 与两类 503 均含合法 `X-Request-Id`，error envelope 的 requestId 一致 | 同上 | P-13/B |
| C-03 | schema mismatch | 503 + `SCHEMA_NOT_READY` + required/current/missing 白名单 details | 同上 | P-01/A |
| C-04 | DB unavailable | 503 + `DATABASE_UNAVAILABLE`，不泄露路径/SQL | 同上 | P-01/P-13/A |
| C-05 | new Generation admission | 202、Location、X-Request-Id、`replayed=false`、原 id/status/links | `generations-api.contract.test.ts` | P-03/P-04/C/D |
| C-06 | same key replay | 202、同 ID、`replayed=true`；engine 不产生第二单 | 同上 | P-03/C |
| C-07 | same key/different payload | 409 `IDEMPOTENCY_KEY_REUSED` | 同上 | P-03/C |
| C-08 | missing/invalid key | 400 structured validation，未创建任务 | 同上 | P-03/C |
| C-09 | errors | validation/auth/config/rate-limit/internal 全为统一 envelope；500 有安全 requestId | 同上 | P-02/P-13/B |
| C-10 | payload too large/invalid JSON | 413 `PAYLOAD_TOO_LARGE` / 400 `INVALID_JSON`；不进入 engine | 同上 | P-04/P-10/B/D |
| C-11 | detail unknown | Job status failed + safe `PROVIDER_OUTCOME_UNKNOWN`；不返回 snapshot/raw URL | 同上或 detail contract | P-04/P-10/D |
| C-12 | cancel | API 不等待远端即可返回 user cancelled；后续 detail 不复活 | 同上 | P-05/D |
| C-13 | not found/unauthorized | stable 404/401，无资源或内部细节泄漏 | 同上 | P-02/B |

最终每个 error contract 断言 `status/code/retryable/requestId`，并断言 response 文本不包含测试 secret、prompt、SQLite path、signed query；Batch A 的 readiness 测试只承担 status/code/details，requestId 从 Batch B 起成为门禁。

## 5. Integration 测试矩阵

### 5.1 Migration/readiness

| ID | 场景 | 必须验证 | 建议文件 |
|---|---|---|---|
| I-01 | 截图同型 schema：已有 projects/sessions，Job 缺 `next_poll_at/cancel_requested_at` | 数据保留、字段补齐、version/manifest/foreign keys 正确、backup 存在 | `tests/smoke/db-current-schema-migrate.smoke.test.ts` |
| I-02 | 再次执行 migration | 无重复列/index/backup 覆盖；report from=to；数据不变 | 同上 |
| I-03 | 迁移中断/非法 schema | 不设置目标 version，readiness 失败，原 backup 可读 | migration smoke |
| I-04 | version 伪造为 latest 但缺 required index | health 503，证明 manifest 不是数字摆设 | readiness integration/contract |

### 5.2 Idempotency/admission

| ID | 场景 | 必须验证 | 对应 |
|---|---|---|---|
| I-06 | 同 key 串行重放 | 一个 Generation、N 个 Jobs、相同 ID，无第二次 Provider dispatch | P-03 |
| I-07 | 同 key 并发 transaction | unique loser 查询赢家；一个 Generation；无 500 | P-03 |
| I-08 | 同 key 异 payload 并发 | 一个成功、一个 409；原任务未被覆盖 | P-03 |
| I-09 | Session touch 被 trigger 强制失败 | Generation/Jobs/Session update 同 transaction 回滚，Provider 0 调用 | P-07 |
| I-10 | admission 后调用方丢响应并重放 | 返回同 ID，任务继续；不重复费用 | P-03/P-04 |
| I-10A | Provider 已返回、Job 状态写回被 DB trigger 强制失败 | 不得被 `Promise.allSettled` 静默算成功；任务保留可恢复 phase 或明确 internal failure | P-07/P-13 |

### 5.3 Crash checkpoint / lifecycle

测试通过“持久化 checkpoint → 丢弃旧 engine instance → 新 worker/GET 恢复”模拟进程退出，不添加生产 test-only 分支。

Batch D 的 lifecycle/retry 测试使用 typed fake Provider，只验证持久化 retry state、phase/lease/CAS、重启预算、成功归零与取消收口；真实 HTTP classifier、七家 adapter 和 limiter 的接线仍由 Batch E 的 I-22… I-25 验收。

| ID | 持久化检查点 | 重启后预期 | 对应 |
|---|---|---|---|
| I-05 | D migration phase backfill | terminal、active+handle、active-no-handle 分别按 `02 §3.4` 落位 | P-04/D |
| I-11 | admission committed，phase queued | worker claim 后只 submit 一次 | P-04 |
| I-12 | phase dispatching、lease 未过期 | 第二 worker 跳过，不并发 submit | P-04/P-08 |
| I-13 | phase dispatching、lease 过期、无 result/handle | `outcome_unknown`，Provider 0 次重投 | P-03/P-04 |
| I-14 | async handle 已持久化 | poll 恢复并完成，不重新 submit | P-04 |
| I-15 | result snapshot 已持久化、0 images | 每次 lease 只存一张缺失 image；多次 claim 后恢复全部 indexes，Provider 不重调 | P-04/P-09 |
| I-16 | result snapshot + index0 已存在 | 下一次 lease 仅补一个缺失 index；最终无重复 row/file，单次外部时长不跨多图预算 | P-09 |
| I-17 | poll Provider 先 running 后 pending | public status 保持 running；后续完成 | P-08 |
| I-18 | Provider 返回空 refs | failed `PROVIDER_EMPTY_RESULT`，0 image，不 completed | P-09 |
| I-19 | Provider 返回少/多 refs | 保留有界有效结果和 warning，永不超 requested count | P-09 |
| I-20 | lease 失效时 storage 响应返回 | 旧 attempt 不写终态；临时/loser file 清理 | P-09 |
| I-21 | store 期间取消 | user cancelled 不复活；attempt images/files 补偿或被 cleanup 精确发现 | P-05/P-09 |
| I-21A | file-backed SQLite poll retry 重启 | 失败 checkpoint 后关闭/重开 DB；同一 retry budget 在 due 后继续，successful poll 清 error/count/window | P-06/D2 |

### 5.4 Retry/cancel/worker

| ID | 场景 | 必须验证 | 对应 |
|---|---|---|---|
| I-22 | limiter queue/pre-send deadline 后成功 | 第一次 Provider server 0 请求、disposition `not_started`、同 job 按 due 安全重排；随后只发送一次 | P-06/E |
| I-22A | submit 429 两次后成功 | real fake HTTP 最多 3 attempts、同 job/request ID、按 due 推进 | P-06/E |
| I-23 | HTTP started 后 submit timeout/connection reset/unknown 5xx | fake server 可观测一次请求；随后 unknown，进程重启也不重投 | P-03/P-06/E |
| I-24 | poll timeout/5xx 后成功 | D2 typed fake 已验证持久化/重启/归零；E 追加 real fake HTTP、Retry-After 与 adapter classifier | P-06/D/E |
| I-25 | poll 连续失败耗尽 | D2 typed fake 已验证第 6 次 terminal `RETRY_EXHAUSTED`、不再 due；E 追加 real fake HTTP | P-06/D/E |
| I-26 | cancel marker committed 后进程退出 | D2 file-backed SQLite 验证 local cancelled + remote cancel retry checkpoint 在关闭/重开后按 due 继续并收口；E/F 可追加 real HTTP/restart process | P-05/D/E |
| I-27 | remote cancel unsupported/fails | D2 验证 retryable 失败预算后停止且本地不回退；不支持/HTTP mapping 的完整矩阵留 E | P-05/P-06/D/E |
| I-28 | due batch 前部均有 active lease | 后续 unleased due jobs 仍被扫描，稳定排序，无饥饿 | P-08 |
| I-29 | limiter queue saturated | 多余任务快速获得可重试本地拒绝，不无限驻留内存 | P-06/P-08 |
| I-30 | fan-out 一 completed、一 unknown | 成功图片保留，Generation partial/警告正确，其他 Provider 不重试 | P-04/P-12 |

### 5.5 Remote image/security

| ID | 场景 | 必须验证 | 对应 |
|---|---|---|---|
| I-31 | redirect 转向 localhost/metadata/private IP | 下载拒绝；目标 server 未收到带 credential 请求 | P-10 |
| I-32 | chunked body 超 25MiB、伪造小 Content-Length | 流式硬上限中止，临时文件清理，Job 可诊断失败 | P-10 |
| I-33 | `image/png` 返回 HTML/JSON | magic mismatch 拒绝，0 image | P-09/P-10 |
| I-34 | signed URL download 500 | API/DB safe error/log 捕获中不含 query token | P-10/P-13 |
| I-35 | duplicate storage attempt | 一个 row/一个最终文件；竞争 loser 清理 | P-09 |
| I-36 | 普通 Provider JSON response > 2 MiB | 流式中止、bounded safe error、raw body 不进 DB/log；Base64 endpoint 改由 I-37 的独立 encoded/decoded 总预算验收 | P-10 |
| I-37 | ZenMux/Doubao Base64 result | 当前单图 endpoint 的 encoded JSON 固定上限 36 MiB、decoded 图片上限 25 MiB；data URL 不进 snapshot；staging ref 可跨进程恢复，超限/非法类型被拒且 temp 清理 | P-09/P-10 |
| I-38 | Fal/Qwen/Kling dynamic endpoint | Fal 非 exact-origin/redirect 被拒；Qwen/Kling 忽略任意 persisted URL 并从 base + external ID 重建；无跨 origin auth | P-10 |

## 6. 固定 Backend E2E 的处理

本轮按 KISS 原则不新增 Next 进程编排、fake Provider server 或空 E2E 命令。HTTP contract、真实 SQLite/storage 协作、Provider HTTP 错误与故障窗口已分别由 contract/integration/smoke 覆盖；未来只有出现“必须经过真实 Next socket 才能复现”的稳定回归时，才为该风险增加最小 Backend E2E。

## 7. 真实 Provider 浏览器 E2E

用户已明确授权本轮使用真实 Provider。验收只选择一个模型且 `count=1`，由本会话启动并持有 `npm run dev`，浏览器不读取或显示 API key。

| ID | 浏览器场景 | 用户可见断言 |
|---|---|---|
| L-W01 | Generate 提交 | 默认仅一个模型；输入 prompt；点击后进入带 generation URL 的 Stage |
| L-W02 | 真实终态图片 | Stage 从 Pending 到 Completed，出现一张真实图片且 `/api/images/:id` 可读 |
| L-W03 | 预览与收藏 | 打开 Image Preview；Provider/model/prompt 正确；收藏按钮进入 pressed 状态 |
| L-W04 | Stage 刷新恢复 | reload 后仍直接显示同 generation 的 Completed、图片和收藏状态 |
| L-W05 | Gallery 浏览与筛选 | Gallery 出现该图片；按 Workspace + Provider 筛选后仍保留，query 与控件状态一致 |
| L-W06 | 失败安全 | 若真实 Provider/转存失败，任务进入明确终态，不自动创建第二单；记录安全 code 与环境边界，不记录密钥/签名 URL |

本轮实测：ZenMux `generation=0d545f04-9925-4579-86f6-9c9af4bf2ca0` 完成 L-W01…L-W05。fal.ai `generation=92f098a6-413e-4dde-9734-81eac0120101` 已由 Provider 生成有效 JPEG，但本机 TUN/fake-IP 将 `v3b.fal.media` 解析到 `198.18.0.125`，触发默认 SSRF 非公网地址拒绝并安全收口为 `STORAGE_ERROR`；这是安全默认与本机代理的兼容边界，不通过放宽生产地址策略掩盖。

## 8. 回归清单

改造不得破坏以下已有行为：

- 1 Generation + N Jobs 原子创建与 target 去重/校验。
- 一家 Provider 失败不删除其他 Provider 已成功图片。
- poll lease 只有一个赢家，旧响应不能覆盖新 lease。
- cancel 后 submit/poll 晚到响应不复活。
- `(jobId,index)` image 幂等与竞争 loser file cleanup。
- History/Session/Generation 列表保持只读，不因列表浏览触发 Provider poll/dispatch。
- Generation detail dialog 与 Generate Stage 共享轮询但不会重复请求。
- prompt、当前/上一任务、路由 sequence 与双击 guard 的现有保护继续有效。
- Gallery/Favorites/History 能读取新任务生成的图片；public status DTO 仍兼容五状态。
- Provider configuration、Models、Projects/Sessions API 与本批无关契约不改变。
- 中英文 message key 完整，typecheck 不允许缺 key。
- 当前未提交 Gallery 紧凑筛选、无卡片 locale switcher 工作树不被覆盖或混入 commit。

## 9. 命令与质量门禁

实施后 `package.json` 应提供：

```json
{
  "test:unit": "vitest run .unit.test.ts",
  "test:contract": "vitest run .contract.test.ts",
  "test:integration": "vitest run .integration.test.ts",
  "test:smoke": "vitest run .smoke.test.ts",
  "test:verify": "npm run typecheck && npm run test:unit && npm run test:contract && npm run test:integration",
  "test:release": "npm run test:verify && npm run test:smoke"
}
```

`test:release` 中的 `build.smoke.test.ts` 会执行 production build；真实 Provider 浏览器 E2E 是本轮受控验收步骤，不伪装为可重复的自动化命令。

### 9.1 分批门禁

| 批次 | 提交前最低命令 | 额外证据 |
|---|---|---|
| 0 docs | markdown/path/traceability 自检；`git diff --check -- <problem-list>` | 仅 stage 新文档 |
| A | compatibility unit + health contract + migration/readiness smoke + typecheck | 真实 `data/app.db` 副本迁移 report |
| B | error handler/api-client/i18n unit + Generation/health contracts + typecheck | secret/redaction negative assertions |
| C | idempotency unit + Generation contract + idempotency integration + typecheck | 并发 loser 只一单 |
| D1/D2 | job-engine/db/worker unit + typed-fake crash/retry/cancel integration + contract + typecheck | 持久 retry state 与每个 checkpoint 的 DB/file assertions；不冒充真实 HTTP 接线 |
| E1 | Provider HTTP/disposition + limiter unit/integration + typecheck | I-22… I-25；pre-send 0 请求，HTTP started unknown 调用次数为 1 |
| E2 | 七 adapter mapping/dynamic URL/auth redirect unit/integration + typecheck | Fal exact origin；Qwen/Kling reconstructed URL；bounded JSON |
| E3 | storage/staging/security unit/integration + typecheck | 每 lease 一张；PNG/JPEG/WebP；Base64 不进 SQLite；temp/loser cleanup |
| F1 | Web Client/Generate/i18n unit + related integration + typecheck | Stage bootstrap 解耦测试 |
| F2 | `npm run test:release` | build smoke、本会话服务日志、真实 Provider 浏览器 flow 与 generation ID |

### 9.2 最终必跑顺序

1. `npm run typecheck`
2. `npm run test:unit`
3. `npm run test:contract`
4. `npm run test:integration`
5. `npm run test:smoke`（包含 production build）
6. 由本会话启动 `npm run dev`，执行 §7 真实 Provider 浏览器 E2E
7. `git diff --check`
8. `git status --short` 核对生成链路 commits 未混入 Gallery/locale 旧改动

任何失败必须修复并从受影响层级向上重跑；不能以“重跑一次绿了”接受 flaky。真实付费 Provider 不属于默认自动化门禁，本轮仅因用户显式授权进入受控验收。

## 10. 可观测与数据验收

自动化或受控手工测试需要捕获 structured logs，至少验证：

- 同一次链路可用 `requestId/clientRequestId/generationId/jobId/provider/phase/attempt` 关联。
- admission、replay、claim、retry schedule、phase transition、terminal/unknown、cancel cleanup 均有事件；正常 pending poll 不产生错误噪音。
- log 不包含 API key、Authorization、Cookie、完整 prompt、request/result snapshot、data URL 或 URL pathname/query/fragment；远端 URL 仅保留 origin + digest。
- worker counters 与最终 DB 领域状态一致。
- schema not ready 在用户提交之前通过 readiness 可见。

对真实 `data/app.db` 的最终只读验收：

1. migration 前已有文件有 backup；
2. required manifest 和 foreign key check 通过；
3. 现有 Projects/Sessions/Generations 行数没有非预期减少；
4. 真实 Provider 只在用户显式授权的浏览器验收中调用；记录 generation/终态，不记录 key、Authorization 或签名 URL。

## 11. 手工验收

在自动化全绿后进行一次短浏览器检查：

1. 中文 Generate 默认仅选择一个模型，多选后调用数/预计图片数清晰。
2. 提交进入 Stage 后，刷新页面仍能先看到任务，不被 Provider 配置列表加载失败遮挡。
3. 临时断网再恢复时，页面保留最后快照并继续检查；没有同步轮询抖动或无限 loading。
4. 切换英文，validation/config/rate-limit/internal/unknown 各选一个可构造场景检查文案与动作。
5. unknown 文案不鼓励盲目重建；显式新建才会产生新 intent。
6. History/Gallery 能看到 E2E 完成图片，详情 Job 的 Provider/model/status 正确。

手工验收记录结果即可，不提交截图或含本地路径/secret 的日志到仓库。

## 12. 对抗性审查

| 攻击面 | 审查问题 | 已规划防御 | 残余风险/接受条件 |
|---|---|---|---|
| Idempotency race | 两个并发 transaction、同 key 异 body、client storage 过期会否重复费用？ | DB unique + canonical hash + conflict + sessionStorage intent | 用户明确修改输入即新意图，会产生新调用；UI 必须展示 |
| Dispatch ambiguity | 崩溃发生在 lease 写入后/HTTP send 前或 Provider accept 后怎么办？ | expired dispatching 默认 unknown，不盲重投 | 可能出现保守 false-unknown；无厂商查询 API 时不可消除 |
| Retry storm | 429/5xx 时多 job/多浏览器是否同步轰炸？ | full jitter、attempt/elapsed budget、queue cap、Retry-After | 单机无全局跨进程 budget；当前单实例范围接受 |
| Cancel/storage race | cancel、lease 失效与图片文件/row 同时发生会否复活或泄漏？ | marker + CAS + temp/atomic file + attempt cleanup + orphan cleanup | 极端进程断电可留临时文件，cleanup/age 门槛后回收 |
| SSRF/credential leak | Provider 返回 private redirect、poisoned status URL 或 DNS rebinding 会否访问内网/带出 key？ | scheme/DNS/IP 预检、manual redirect 每跳复核、exact auth origin；Fal URL 校验，Qwen/Kling URL 重建 | native fetch 在预检后自行解析存在 TOCTOU；MVP 明确接受且不宣称完全阻断 rebinding。需要更强保证时改用 pin 已校验地址的自定义 transport |
| Sensitive diagnostics | raw vendor body、签名 URL、prompt 会否进入 DB/API/log？ | safe code registry、redaction、snapshot 非 DTO、终态清空 | SQLite 本身仍保存业务 prompt；全库加密 out of scope |
| Schema/test drift | helper 最新 schema 是否继续掩盖真实 migration？ | exact previous-schema fixture + manifest + smoke + readiness | 每次新增列必须同时增 previous-schema fixture/manifest |
| Frontend stale work | route change、hidden/offline、hung fetch、旧 response 会否覆盖新任务？ | abort/deadline/sequence/monotonic state/pause+resume | 浏览器被强杀后依赖 sessionStorage + server idempotency 找回 |

## 13. 子代理审查门禁

实现、`test:release`（含 production build）与受控浏览器 E2E 完成后，同时启动三名只读子代理：

1. **DB/job lifecycle reviewer**：migration、transaction、idempotency、phase transition、lease、crash/cancel、worker fairness。
2. **Provider/storage security reviewer**：retry disposition、deadline/queue、SSRF/redirect/auth forwarding、size/type/magic、redaction/file cleanup。
3. **API/Web/test/docs reviewer**：202/error contract、intent/Stage recovery/i18n、E2E 真实性、`02/04` 与权威 MVP 文档对齐。

审查输入必须是最终 diff + `01/02/04`；子代理不得修改文件。每条发现包含 severity、证据路径/行、可复现场景和建议。主代理执行：

1. 去重与复核事实；
2. 修复 Blocker/High 和可信 Medium；
3. 运行直接相关测试；
4. 再跑 `test:release`；
5. 必要时让原 reviewer 复查修复点。

验收不以“子代理说通过”为依据，而以发现已处理、自动化和主代理最终核对共同成立为依据。

## 14. P-01…P-14 验收追踪

| 风险 | 最低验收证据 |
|---|---|
| P-01 | U-01/02、C-01…04、I-01…05、smoke |
| P-02 | U-18/19、C-09/13、L-W06 |
| P-03 | U-03/04/17、C-05…08、I-06…10、L-W01 |
| P-04 | U-05、I-11…16、L-W01/02 |
| P-05 | U-05/06、C-12、I-21/26/27 |
| P-06 | U-08…12、I-22…29 |
| P-07 | I-09、I-10A |
| P-08 | U-05…07/22、I-12/17/28 |
| P-09 | U-07/15、I-15…21/32/33/35、L-W02/06 |
| P-10 | U-13…16、I-31…34 |
| P-11 | U-17…20、L-W04 |
| P-12 | U-21、I-30、L-W01 |
| P-13 | U-16/18/22、C-02/04/09、I-34、日志验收 |
| P-14 | I-01…05、I-11…35、L-W01…06、build/smoke |

## 15. 发布/完成门

| 门 | 通过标准 | 阻断条件 |
|---|---|---|
| 文档 | README/00/01/02/04 与权威模块文档一致 | code 已变但文档仍写旧语义 |
| 数据 | migration 可重复、有 backup/report、真实库 compatible | 数据减少、foreign key 违规、readiness 假绿 |
| 一致性 | idempotency/crash/cancel/storage 场景通过 | 任一可复现重复 Provider submit/终态复活 |
| 安全 | remote ingestion/redaction tests 通过 | SSRF、credential/signed URL 泄漏、无界 body |
| UX | actionable i18n、Stage refresh/recovery、unknown 语义通过 | 仍只显示通用错误或自动新建任务 |
| 验证 | 非空自动化门禁全绿、build 通过、真实 Provider 浏览器 flow 有明确 generation/终态 | 空命令假绿、flaky 重跑才绿、build 或 live flow 失败且无解释 |
| 审查 | 三类子代理审查完成且无未处理 Blocker/High | 高风险发现未处理或无法解释 |
| Git | 每批原子 commit、无 Gallery/locale 混入 | commit 混杂或用户已有修改丢失 |

满足全部门后，再进入 `plan-code-improvement` 验收模式对照 `02/04` 做最终实施一致性检查；自检过程和子代理 transcript 不写入仓库。
