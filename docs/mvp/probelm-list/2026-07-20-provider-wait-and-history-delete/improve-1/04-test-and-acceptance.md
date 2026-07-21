# 4. 测试与验收标准

> 遵循项目级 [`docs/test-blueprint.md`](../../../../test-blueprint.md)。本文件只定义本批变更的风险验证。

## 4.1 测试范围

- **Unit**：状态机分支、Provider wait 调度、worker drain、删除 DB helper、History state 合并和 UI 可见状态。
- **Contract**：`POST /api/generations` 超过旧上限仍返回 202；`GET detail` 的等待字段；`DELETE` 的 204/404/409 契约。
- **Integration**：临时 SQLite + local storage + MSW/typed fake Provider，验证持续 429、取消、图片墓碑、Generation 聚合删除、live 文件清理和 cascade。
- **手工验收**：单实例启动后，离开生成详情页，首个 Generation 仍在后台更新；分别验证自动过期、单图删除与“删除整条生成记录”的可见状态。
- 不调用真实 Provider，不把付费 API 调用放入自动化测试。

## 4.2 关键场景

| ID | 场景 | 类型 | 验证点 | 对应 Phase |
|---|---|---|---|---|
| W-01 | 示例/生产配置启用 worker | Unit + 手工 | `JOB_WORKER_ENABLED=true` 时 POST 后启动唯一 worker；关闭详情订阅后 due job 仍被推进。 | 1 |
| W-02 | worker 内部页式 drain | Unit | 超过一页的 due jobs 全部最终被扫描；已被推迟的 `nextPollAt` job 不形成 busy loop；无界 Promise 不出现。 | 1 |
| A-01 | 超过 8 个合法 targets | Contract + Integration | POST 返回 202；1 Generation 对应 N jobs；没有 `MAX_GENERATION_TARGETS` 校验。 | 1 |
| A-02 | 非法或重复 target | Unit + Contract | 空数组、重复 `(provider,model)`、不支持的 capability 仍被拒绝；仅移除数量硬上限。 | 1 |
| P-01 | 无本地 Provider limiter | Unit | 多个同 Provider job 的 `provider.submit` 不被 `withProviderLimit` 排队或拒绝；不再出现 `QUEUE_SATURATED`。 | 2 |
| P-02 | Provider 429 持续等待 | Unit + Integration | 连续超过旧 3 次/30 秒的明确 429 后，job 仍为 pending/queued，持久化 `nextPollAt`，没有 terminal failed。 | 2 |
| P-03 | 429 跨重启恢复 | Integration | 关闭并重开 file-backed SQLite 后，到期 job 继续等待重试；不丢失安全 `RATE_LIMITED` 提示。 | 2 |
| P-04 | 429 后成功 | Unit + Integration | 下一次 accepted submit 清除等待提示，进入原有 sync/async 生命周期。 | 2 |
| P-05 | timeout/5xx | Unit | 不进入无限等待；保持 `outcome_unknown`，不得再发 billable submit。 | 2 |
| P-06 | 用户取消等待 | Unit + Integration | pending rate-limited job cancel 后 terminal cancelled，后续 worker 不再 submit。 | 2 |
| P-07 | 等待 UI | Unit + 浏览器手工 | pending 的 rate-limited job 显示友好等待提示和取消入口，而不是终态失败文案。 | 2 |
| R-01 | 自动 retention | Integration + Contract | 旧未收藏图片变 `retention_expired`；Generation/jobs/Prompt/Provider error 和 image tombstone 保留；detail/history 不为 404。 | 3/关联 improve-3 |
| R-02 | 单图主动删除 | Integration + Contract | `DELETE /api/images/:id` 留 `user_deleted` tombstone；所属 Generation detail/history 继续存在。 | 3/关联 improve-3 |
| D-01 | 删除 completed/failed/terminal cancelled | Integration + Contract | 明确 Generation DELETE 204；generation/jobs/available+tombstone images/favorites 被删除；后续 detail 404。 | 3 |
| D-02 | 删除 cancelling/active | Integration + Contract | DELETE 409 `GENERATION_NOT_DELETABLE`；不删任何 row/file。 | 3 |
| D-03 | 删除 outcome unknown | Contract + UI | 首次 DELETE 返回确认专用 409；带 `confirmUnknownOutcome=true` 后 204；UI 文案明确是仅删除本地记录。 | 3 |
| D-04 | live 文件、tombstone 与 staging 清理 | Integration | 只对 non-null live path 删除文件；tombstone 直接 cascade；文件异常不回滚 DB，孤儿扫描后续回收；staging ref 清理。 | 3 |
| D-05 | History/Gallery 刷新 | Component + 手工 | retention/单图删除不减少 Generation 历史；Generation 删除才更新分组/图片总数与分页，Gallery 不保留该聚合的收藏项。 | 3 |
| D-06 | 收藏图片所在 Generation | Contract + UI | 整条删除确认明确收藏也会删除；确认后 favorite/image/generation 全部消失；取消确认无副作用。 | 3 |
| D-07 | 外部下载副本 | Integration + 手工 | Generation 删除只删除 `LOCAL_STORAGE_DIR` 管理内文件；用户导出路径不被记录、扫描或删除。 | 3 |
| D-08 | Generation DELETE 与 retention/单图删除竞态 | Unit + Integration | transaction 以当前 availability 收集 live path；最终聚合删除完整；重复文件 remove 幂等，无坏 favorite/orphan row。 | 3 |

## 4.3 集成边界

| 边界 | 验证方法 |
|---|---|
| API → job-engine → SQLite | route contract + 临时 SQLite；断言 202、409、204 和最终 durable rows。 |
| lifecycle → Provider | MSW 或 typed fake Provider，分别返回 accepted、429、timeout/5xx；不得调用真实网络。 |
| job-engine → storage | 临时 `LOCAL_STORAGE_DIR`，验证只删除 aggregate 内 non-null live path、tombstone 不伪造路径、DB transaction 后的文件删除与 orphan fallback。 |
| browser UI → API client | mock `ApiClient`，验证等待 notice、确认删除、刷新和焦点/可访问性。 |
| improve-3 image model → Generation delete | schema v4 fixture 同时包含 available、`retention_expired`、`user_deleted`、`storage_missing`；验证聚合 cascade 与 History scope。 |

## 4.4 回归清单

- 单 target 提交、idempotency replay 和已存在的 Provider capability 校验仍通过。
- async Provider 的 poll、图片转存、partial failure 和取消 lease 语义不变。
- HTTP timeout/网络错误仍不重复 dispatch。
- History 读取仍保持只读，不触发 `advance()`。
- Favorites 的独立添加/删除 API 不受影响。
- 自动 retention 和 `DELETE /api/images/:id` 都保留 Generation/Job/Prompt/error；只有 `DELETE /api/generations/:id` 移除整条聚合。
- History 图片数在 retention/单图删除后仍包含 tombstone；项目封面/Gallery 只选择 available 图片。
- `npm run typecheck`、`npm run test:fast`、相关 integration 测试和 `npm run build` 通过。

## 4.5 发布验收门

| 项 | 标准 | 如何验证 |
|---|---|---|
| 单实例后台推进 | 详情页关闭后 job 仍推进 | 启动 `JOB_WORKER_ENABLED=true` 的本地服务，提交 async fake flow，离开页面后检查 DB/History 终态。 |
| 无 target 上限 | 9 个以上合法 target 可 admission | contract/integration 自动测试。 |
| 厂商等待 | 429 不会在旧预算后失败，取消可停止 | P-02、P-03、P-06。 |
| 防重复计费 | unknown submit 不重发 | P-05 和既有 dispatch lease 回归。 |
| scope 分离 | retention/单图删除留历史，Generation DELETE 才硬删聚合 | R-01、R-02、D-01、D-05。 |
| 删除完整性 | available/tombstone 行、收藏、live 文件和 staging 一致 | D-01、D-04、D-08。 |
| 删除竞态 | cancelling 与 outcome unknown 不被静默硬删 | D-02、D-03。 |
| 用户预期 | 收藏影响被明确说明，外部下载副本不被删除 | D-06、D-07。 |
| 完整质量门 | 类型、快速测试、相关 integration、构建通过 | `npm run preflight`；`npm run test:integration`；`npm run build`。 |

## 4.6 对抗性审查要点

| 攻击面 / 失败模式 | 防御 | 残余风险 |
|---|---|---|
| 伪造或错误映射的 429 让未知 submit 无限重投 | 只有 `RATE_LIMITED` 且安全 disposition 才进入 wait；timeout/5xx 保持 unknown。 | Adapter 对厂商错误码的错误分类仍需 adapter 测试覆盖。 |
| 429 立即 due 导致 worker 热循环 | `Retry-After`/退避必须写未来 `nextPollAt`；worker drain 遇到 deferred job 停止。 | 厂商没有 Retry-After 时只能采用本地退避估计。 |
| 无 target 上限导致内存或 socket 爆炸 | request-body 限制、去重/capability 校验、worker 内部页式处理。 | 单用户仍能主动提交极大请求，需依赖运行时资源监控。 |
| DELETE 与 cancelling worker 竞争 | 后端 transaction 按内部 phase 裁决，活跃 phase 一律 409。 | 远端不支持取消时仍可能继续计费，UI 要说明。 |
| DB 已删、文件删失败 | DB commit 后 best-effort 删除 + orphan scanner。 | 文件可能在 grace period 内暂时占用磁盘。 |
| 自动过期被误接到 Generation DELETE | 不共享 destructive API；retention 只调用 image tombstone query，契约测试冻结 scope。 | 实施时命名/调用链仍需 code review。 |
| tombstone 的 NULL path 被当作字符串删除 | 只收集 available + non-null path；v4 fixture 覆盖所有 availability。 | 外部手工篡改 DB 仍由 schema CHECK/兼容检查处理。 |
| 收藏被用户误认为阻止整条删除 | 确认对话列出收藏和图片也会删除；取消是默认安全路径。 | 用户确认后的硬删除不可恢复。 |
| 应用试图删除导出文件 | 应用不持久化/扫描用户选择的导出位置；只处理 storage root 内 canonical path。 | 用户自行覆盖/删除外部文件不在应用控制范围。 |
| 历史行为按钮嵌套 | 重构 row 结构，删除控件不能嵌在打开详情的 `<button>` 内。 | 需手工验收键盘焦点和屏幕阅读器标签。 |
